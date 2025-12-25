import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'dart:convert';
import '../models/wallet_model.dart';
import '../models/transaction_model.dart';
import '../models/payment_method_model.dart';
import '../models/transfer_model.dart';
import '../services/api_service.dart';

class WalletProvider extends ChangeNotifier {
  WalletModel? _wallet;
  List<WalletTransactionModel> _transactions = [];
  List<PaymentMethodModel> _paymentMethods = [];
  List<WalletTransferModel> _sentTransfers = [];
  List<WalletTransferModel> _receivedTransfers = [];
  bool _isLoading = false;
  String? _error;
  String? _successMessage;
  String _filterType = '';
  bool _hasMoreTransactions = true;
  bool _hasMoreSentTransfers = true;
  bool _hasMoreReceivedTransfers = true;

  WalletModel? get wallet => _wallet;
  List<WalletTransactionModel> get transactions => _transactions;
  List<PaymentMethodModel> get paymentMethods => _paymentMethods;
  List<WalletTransferModel> get sentTransfers => _sentTransfers;
  List<WalletTransferModel> get receivedTransfers => _receivedTransfers;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get successMessage => _successMessage;
  bool get hasMoreTransactions => _hasMoreTransactions;
  bool get hasMoreSentTransfers => _hasMoreSentTransfers;
  bool get hasMoreReceivedTransfers => _hasMoreReceivedTransfers;

  Future<void> loadWalletBalance(String token) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getWalletBalance(token);

      if (data['success'] == true && data['wallet'] != null) {
        _wallet = WalletModel.fromJson(data['wallet']);
        
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('wallet_cache', jsonEncode(_wallet!.toJson()));
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to load wallet';
        _loadCachedWallet();
      }
    } catch (e) {
      _error = e.toString();
      _loadCachedWallet();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _loadCachedWallet() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString('wallet_cache');
      if (cached != null) {
        _wallet = WalletModel.fromJson(jsonDecode(cached));
      }
    } catch (e) {
      // Ignore cache errors
    }
  }

  Future<void> loadTransactions(
    String token, {
    int limit = 20,
    int offset = 0,
    String? type,
  }) async {
    if (offset == 0) {
      _isLoading = true;
      _transactions = [];
    }
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getWalletTransactions(
        token,
        limit: limit,
        offset: offset,
        type: type,
      );

      if (data['success'] == true && data['transactions'] != null) {
        final newTransactions = (data['transactions'] as List)
            .map((t) => WalletTransactionModel.fromJson(t))
            .toList();

        if (offset == 0) {
          _transactions = newTransactions;
        } else {
          _transactions.addAll(newTransactions);
        }

        final total = data['total'] as int? ?? 0;
        _hasMoreTransactions = _transactions.length < total;

        _cacheTransactions();
      } else {
        _error = data['message'] ?? 'Failed to load transactions';
        if (offset == 0) {
          _loadCachedTransactions();
        }
      }
    } catch (e) {
      _error = e.toString();
      if (offset == 0) {
        _loadCachedTransactions();
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _cacheTransactions() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonList = _transactions.map((t) => t.toJson()).toList();
      await prefs.setString('transactions_cache', jsonEncode(jsonList));
    } catch (e) {
      // Ignore cache errors
    }
  }

  Future<void> _loadCachedTransactions() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString('transactions_cache');
      if (cached != null) {
        final jsonList = jsonDecode(cached) as List;
        _transactions = jsonList
            .map((t) => WalletTransactionModel.fromJson(t))
            .toList();
      }
    } catch (e) {
      // Ignore cache errors
    }
  }

  void filterTransactions(String type) {
    _filterType = type;
    if (type.isEmpty) {
      notifyListeners();
      return;
    }
    notifyListeners();
  }

  List<WalletTransactionModel> getFilteredTransactions() {
    if (_filterType.isEmpty) {
      return _transactions;
    }
    return _transactions
        .where((t) => t.type.toLowerCase() == _filterType.toLowerCase())
        .toList();
  }

  Future<void> loadAutoRechargeSettings(String token) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getAutoRechargeSettings(token);

      if (data['success'] == true) {
        if (_wallet != null) {
          _wallet = _wallet!.copyWith(
            autoRechargeEnabled: data['enabled'] ?? false,
            autoRechargeAmount:
                (data['amount'] as num?)?.toDouble(),
            autoRechargeThreshold:
                (data['threshold'] as num?)?.toDouble(),
          );
        }
      } else {
        _error = data['message'] ?? 'Failed to load auto-recharge settings';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> saveAutoRechargeSettings(
    String token, {
    required bool enabled,
    required double amount,
    required double threshold,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      if (enabled && (amount <= 0 || threshold <= 0)) {
        _error = 'Amount and threshold must be greater than 0';
        _isLoading = false;
        notifyListeners();
        return;
      }

      if (enabled && threshold >= amount) {
        _error = 'Threshold must be less than recharge amount';
        _isLoading = false;
        notifyListeners();
        return;
      }

      final data = await ApiService.saveAutoRechargeSettings(
        token,
        enabled: enabled,
        amount: amount,
        threshold: threshold,
      );

      if (data['success'] == true) {
        if (_wallet != null) {
          _wallet = _wallet!.copyWith(
            autoRechargeEnabled: enabled,
            autoRechargeAmount: enabled ? amount : null,
            autoRechargeThreshold: enabled ? threshold : null,
          );
        }
        _successMessage = 'Auto-recharge settings updated successfully';
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to save settings';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }

  void clearSuccessMessage() {
    _successMessage = null;
    notifyListeners();
  }

  Future<void> refreshWallet(String token) async {
    await loadWalletBalance(token);
  }

  Future<void> topupWallet(
    String token, {
    required double amount,
    required bool saveCard,
  }) async {
    _isLoading = true;
    _error = null;
    _successMessage = null;
    notifyListeners();

    try {
      if (amount <= 0) {
        _error = 'Amount must be greater than 0';
        _isLoading = false;
        notifyListeners();
        return;
      }

      // Create Stripe payment method from card
      final paymentMethod = await Stripe.instance.createPaymentMethod(
        params: const PaymentMethodParams.card(
          paymentMethodData: PaymentMethodData(),
        ),
      );

      // Call server topup API
      final data = await ApiService.topupWallet(
        token,
        amount: amount,
        paymentMethod: 'card',
        cardToken: paymentMethod.id,
        saveCard: saveCard,
      );

      if (data['success'] == true) {
        _successMessage =
            'Successfully added PKR ${amount.toStringAsFixed(2)} to your wallet!';
        
        // Update wallet balance
        if (_wallet != null) {
          final newBalance = _wallet!.balance + amount;
          _wallet = _wallet!.copyWith(
            balance: newBalance,
            totalCredited: _wallet!.totalCredited + amount,
          );
          
          // Cache updated wallet
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('wallet_cache', jsonEncode(_wallet!.toJson()));
        }
        
        // If card was saved, reload payment methods
        if (saveCard) {
          loadPaymentMethods(token);
        }
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to process topup';
      }
    } on StripeException catch (e) {
      _error = 'Payment error: ${e.error.localizedMessage}';
    } catch (e) {
      _error = 'An error occurred: ${e.toString()}';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Payment Methods
  Future<void> loadPaymentMethods(String token) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getPaymentMethods(token);

      if (data['success'] == true && data['paymentMethods'] != null) {
        _paymentMethods = (data['paymentMethods'] as List)
            .map((p) => PaymentMethodModel.fromJson(p))
            .toList();
        
        _cachePaymentMethods();
      } else {
        _error = data['message'] ?? 'Failed to load payment methods';
        _loadCachedPaymentMethods();
      }
    } catch (e) {
      _error = e.toString();
      _loadCachedPaymentMethods();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _cachePaymentMethods() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonList = _paymentMethods.map((p) => p.toJson()).toList();
      await prefs.setString('payment_methods_cache', jsonEncode(jsonList));
    } catch (e) {
      // Ignore cache errors
    }
  }

  Future<void> _loadCachedPaymentMethods() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString('payment_methods_cache');
      if (cached != null) {
        final jsonList = jsonDecode(cached) as List;
        _paymentMethods = jsonList
            .map((p) => PaymentMethodModel.fromJson(p))
            .toList();
      }
    } catch (e) {
      // Ignore cache errors
    }
  }

  Future<void> setPrimaryPaymentMethod(String token, int id) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.setPrimaryPaymentMethod(token, id);

      if (data['success'] == true) {
        // Update local state
        _paymentMethods = _paymentMethods.map((p) {
          return p.copyWith(isPrimary: p.id == id);
        }).toList();
        
        _successMessage = 'Primary payment method updated';
        _cachePaymentMethods();
      } else {
        _error = data['message'] ?? 'Failed to update primary payment method';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> deletePaymentMethod(String token, int id) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.deletePaymentMethod(token, id);

      if (data['success'] == true) {
        _paymentMethods.removeWhere((p) => p.id == id);
        _successMessage = 'Payment method deleted successfully';
        _cachePaymentMethods();
      } else {
        _error = data['message'] ?? 'Failed to delete payment method';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> topupWithSavedCard(
    String token, {
    required double amount,
    required int paymentMethodId,
  }) async {
    _isLoading = true;
    _error = null;
    _successMessage = null;
    notifyListeners();

    try {
      if (amount <= 0) {
        _error = 'Amount must be greater than 0';
        _isLoading = false;
        notifyListeners();
        return;
      }

      final data = await ApiService.topupWallet(
        token,
        amount: amount,
        paymentMethod: 'card',
        cardToken: paymentMethodId.toString(),
        saveCard: false,
      );

      if (data['success'] == true) {
        _successMessage =
            'Successfully added PKR ${amount.toStringAsFixed(2)} to your wallet!';
        
        // Update wallet balance
        if (_wallet != null) {
          final newBalance = _wallet!.balance + amount;
          _wallet = _wallet!.copyWith(
            balance: newBalance,
            totalCredited: _wallet!.totalCredited + amount,
          );
          
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('wallet_cache', jsonEncode(_wallet!.toJson()));
        }
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to process topup';
      }
    } catch (e) {
      _error = 'An error occurred: ${e.toString()}';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // P2P Transfers
  Future<void> sendMoney(
    String token, {
    int? recipientId,
    String? email,
    required double amount,
    String? description,
  }) async {
    _isLoading = true;
    _error = null;
    _successMessage = null;
    notifyListeners();

    try {
      if (amount <= 0) {
        _error = 'Amount must be greater than 0';
        _isLoading = false;
        notifyListeners();
        return;
      }

      if (_wallet != null && _wallet!.balance < amount) {
        _error = 'Insufficient balance';
        _isLoading = false;
        notifyListeners();
        return;
      }

      final data = await ApiService.sendMoney(
        token,
        recipientId: recipientId,
        email: email,
        amount: amount,
        description: description,
      );

      if (data['success'] == true) {
        _successMessage = 'Money sent successfully!';
        
        // Refresh balance
        await loadWalletBalance(token);
        
        // Refresh sent transfers
        await loadSentTransfers(token);
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to send money';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadSentTransfers(
    String token, {
    int limit = 20,
    int offset = 0,
  }) async {
    if (offset == 0) {
      _isLoading = true;
      _sentTransfers = [];
    }
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getSentTransfers(
        token,
        limit: limit,
        offset: offset,
      );

      if (data['success'] == true && data['transfers'] != null) {
        final newTransfers = (data['transfers'] as List)
            .map((t) => WalletTransferModel.fromJson(t))
            .toList();

        if (offset == 0) {
          _sentTransfers = newTransfers;
        } else {
          _sentTransfers.addAll(newTransfers);
        }

        final total = data['total'] as int? ?? 0;
        _hasMoreSentTransfers = _sentTransfers.length < total;
      } else {
        _error = data['message'] ?? 'Failed to load sent transfers';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadReceivedTransfers(
    String token, {
    int limit = 20,
    int offset = 0,
  }) async {
    if (offset == 0) {
      _isLoading = true;
      _receivedTransfers = [];
    }
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.getReceivedTransfers(
        token,
        limit: limit,
        offset: offset,
      );

      if (data['success'] == true && data['transfers'] != null) {
        final newTransfers = (data['transfers'] as List)
            .map((t) => WalletTransferModel.fromJson(t))
            .toList();

        if (offset == 0) {
          _receivedTransfers = newTransfers;
        } else {
          _receivedTransfers.addAll(newTransfers);
        }

        final total = data['total'] as int? ?? 0;
        _hasMoreReceivedTransfers = _receivedTransfers.length < total;
      } else {
        _error = data['message'] ?? 'Failed to load received transfers';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> acceptTransfer(String token, int transferId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.acceptTransfer(token, transferId);

      if (data['success'] == true) {
        _successMessage = 'Transfer accepted successfully!';
        
        // Update local status
        _receivedTransfers = _receivedTransfers.map((t) {
          if (t.id == transferId) {
            return t.copyWith(status: 'completed', completedAt: DateTime.now());
          }
          return t;
        }).toList();

        // Refresh balance
        await loadWalletBalance(token);
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to accept transfer';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> rejectTransfer(String token, int transferId, {String? reason}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.rejectTransfer(token, transferId, reason: reason);

      if (data['success'] == true) {
        _successMessage = 'Transfer rejected';
        
        // Update local status
        _receivedTransfers = _receivedTransfers.map((t) {
          if (t.id == transferId) {
            return t.copyWith(status: 'rejected', rejectionReason: reason);
          }
          return t;
        }).toList();
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to reject transfer';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> cancelTransfer(String token, int transferId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await ApiService.cancelTransfer(token, transferId);

      if (data['success'] == true) {
        _successMessage = 'Transfer cancelled';
        
        // Update local status
        _sentTransfers = _sentTransfers.map((t) {
          if (t.id == transferId) {
            return t.copyWith(status: 'cancelled');
          }
          return t;
        }).toList();

        // Refresh balance
        await loadWalletBalance(token);
        
        _error = null;
      } else {
        _error = data['message'] ?? 'Failed to cancel transfer';
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
