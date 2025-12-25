import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/wallet_provider.dart';
import '../widgets/wallet_balance_card.dart';
import '../widgets/topup_form.dart';
import '../widgets/transaction_list_item.dart';
import '../widgets/auto_recharge_settings.dart';
import '../widgets/payment_method_card.dart';
import '../widgets/send_money_form.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _filterType = '';
  int _transactionOffset = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _loadWalletData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _loadWalletData() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      wallet.loadWalletBalance(auth.token!);
      wallet.loadPaymentMethods(auth.token!);
      wallet.loadSentTransfers(auth.token!);
      wallet.loadReceivedTransfers(auth.token!);
    }
  }

  Future<void> _refreshWallet() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.loadWalletBalance(auth.token!);
      await wallet.loadPaymentMethods(auth.token!);
      await wallet.loadSentTransfers(auth.token!);
      await wallet.loadReceivedTransfers(auth.token!);
    }
  }

  Future<void> _loadTransactions() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      _transactionOffset = 0;
      await wallet.loadTransactions(
        auth.token!,
        offset: 0,
        type: _filterType.isEmpty ? null : _filterType,
      );
    }
  }

  Future<void> _loadMoreTransactions() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      _transactionOffset += 20;
      await wallet.loadTransactions(
        auth.token!,
        offset: _transactionOffset,
        type: _filterType.isEmpty ? null : _filterType,
      );
    }
  }

  void _applyFilter(String type) {
    setState(() {
      _filterType = type;
    });
    _loadTransactions();
  }

  Future<void> _handleAutoRechargeSave(
    bool enabled,
    double amount,
    double threshold,
  ) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.saveAutoRechargeSettings(
        auth.token!,
        enabled: enabled,
        amount: amount,
        threshold: threshold,
      );
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 4),
          ),
        );
        wallet.clearSuccessMessage();
      }
    }
  }

  Future<void> _handleTopup(double amount, bool saveCard) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.topupWallet(
        auth.token!,
        amount: amount,
        saveCard: saveCard,
      );
      
      _handleTopupResult();
    }
  }

  Future<void> _handleSavedCardTopup(double amount, int paymentMethodId) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.topupWithSavedCard(
        auth.token!,
        amount: amount,
        paymentMethodId: paymentMethodId,
      );
      
      _handleTopupResult();
    }
  }

  void _handleTopupResult() {
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    if (wallet.successMessage != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(wallet.successMessage!),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 4),
        ),
      );
      wallet.clearSuccessMessage();
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) {
          _loadWalletData();
        }
      });
    } else if (wallet.error != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(wallet.error!),
          backgroundColor: Colors.red,
        ),
      );
      wallet.clearError();
    }
  }

  Future<void> _handleSetPrimary(int id) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.setPrimaryPaymentMethod(auth.token!, id);
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      } else if (wallet.error != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.error!),
            backgroundColor: Colors.red,
          ),
        );
        wallet.clearError();
      }
    }
  }

  Future<void> _handleDeletePaymentMethod(int id) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Payment Method'),
        content: const Text(
          'Are you sure you want to delete this payment method? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true && auth.token != null) {
      await wallet.deletePaymentMethod(auth.token!, id);
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      } else if (wallet.error != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.error!),
            backgroundColor: Colors.red,
          ),
        );
        wallet.clearError();
      }
    }
  }

  Future<void> _handleSendMoney({int? recipientId, String? email, required double amount, String? description}) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.sendMoney(
        auth.token!,
        recipientId: recipientId,
        email: email,
        amount: amount,
        description: description,
      );
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      }
    }
  }

  Future<void> _cancelTransfer(int id) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel Transfer'),
        content: const Text(
          'Are you sure you want to cancel this pending transfer? The amount will be returned to your balance.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('No'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );

    if (confirm == true && auth.token != null) {
      await wallet.cancelTransfer(auth.token!, id);
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      }
    }
  }

  Future<void> _handleAcceptTransfer(int id) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    
    if (auth.token != null) {
      await wallet.acceptTransfer(auth.token!, id);
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      }
    }
  }

  Future<void> _handleRejectTransfer(int id) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final wallet = Provider.of<WalletProvider>(context, listen: false);
    final reasonController = TextEditingController();
    
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reject Transfer'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Are you sure you want to reject this transfer?'),
            const SizedBox(height: 16),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: 'Reason (Optional)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Reject'),
          ),
        ],
      ),
    );

    if (confirm == true && auth.token != null) {
      await wallet.rejectTransfer(auth.token!, id, reason: reasonController.text);
      
      if (wallet.successMessage != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(wallet.successMessage!),
            backgroundColor: Colors.green,
          ),
        );
        wallet.clearSuccessMessage();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Wallet'),
        elevation: 0,
        backgroundColor: const Color(0xFF667eea),
        foregroundColor: Colors.white,
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Balance'),
            Tab(text: 'Top Up'),
            Tab(text: 'Payments'),
            Tab(text: 'Transfers'),
            Tab(text: 'History'),
          ],
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          indicatorColor: Colors.white,
          indicatorWeight: 3,
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildBalanceTab(),
          _buildTopupTab(),
          _buildPaymentsTab(),
          _buildTransfersTab(),
          _buildHistoryTab(),
        ],
      ),
    );
  }

  Widget _buildBalanceTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        return SingleChildScrollView(
          child: Column(
            children: [
              WalletBalanceCard(
                wallet: walletProvider.wallet,
                isLoading: walletProvider.isLoading,
                onRefresh: _refreshWallet,
              ),
              if (walletProvider.error != null)
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, color: Colors.red.shade700),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          walletProvider.error!,
                          style: TextStyle(
                            color: Colors.red.shade700,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Container(
                margin: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ExpansionTile(
                  title: const Text(
                    'Auto-Recharge Settings',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  children: [
                    AutoRechargeSettings(
                      isEnabled: walletProvider.wallet?.autoRechargeEnabled ?? false,
                      rechargeAmount: walletProvider.wallet?.autoRechargeAmount,
                      thresholdAmount: walletProvider.wallet?.autoRechargeThreshold,
                      isLoading: walletProvider.isLoading,
                      error: walletProvider.error,
                      onSave: _handleAutoRechargeSave,
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTopupTab() {
    return Consumer2<AuthProvider, WalletProvider>(
      builder: (context, auth, wallet, _) {
        return TopupForm(
          isLoading: wallet.isLoading,
          error: wallet.error,
          savedPaymentMethods: wallet.paymentMethods,
          onSubmit: _handleTopup,
          onSavedCardSubmit: _handleSavedCardTopup,
        );
      },
    );
  }

  Widget _buildPaymentsTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        final paymentMethods = walletProvider.paymentMethods;

        if (walletProvider.isLoading && paymentMethods.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (paymentMethods.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.credit_card_off, size: 64, color: Colors.grey[300]),
                const SizedBox(height: 16),
                const Text(
                  'No saved payment methods',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  'Save a card during top up to see it here',
                  style: TextStyle(color: Colors.grey[600]),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: _refreshWallet,
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: paymentMethods.length,
            itemBuilder: (context, index) {
              final pm = paymentMethods[index];
              return PaymentMethodCard(
                paymentMethod: pm,
                onSetPrimary: () => _handleSetPrimary(pm.id),
                onDelete: () => _handleDeletePaymentMethod(pm.id),
                isSettingPrimary: walletProvider.isLoading,
                isDeleting: walletProvider.isLoading,
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildTransfersTab() {
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          const TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: 'Send Money'),
              Tab(text: 'Sent'),
              Tab(text: 'Received'),
            ],
            labelColor: Color(0xFF667eea),
            unselectedLabelColor: Colors.grey,
            indicatorColor: Color(0xFF667eea),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _buildSendMoneyTab(),
                _buildSentTransfersTab(),
                _buildReceivedTransfersTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSendMoneyTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        return SendMoneyForm(
          currentBalance: walletProvider.wallet?.balance ?? 0.0,
          isLoading: walletProvider.isLoading,
          error: walletProvider.error,
          onSubmit: _handleSendMoney,
        );
      },
    );
  }

  Widget _buildSentTransfersTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        final transfers = walletProvider.sentTransfers;

        if (walletProvider.isLoading && transfers.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (transfers.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.send_outlined, size: 64, color: Colors.grey[300]),
                const SizedBox(height: 16),
                const Text(
                  'No sent transfers',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  'Your sent transfers will appear here',
                  style: TextStyle(color: Colors.grey[600]),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: _refreshWallet,
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: transfers.length,
            itemBuilder: (context, index) {
              final transfer = transfers[index];
              return _buildTransferCard(transfer, isSent: true);
            },
          ),
        );
      },
    );
  }

  Widget _buildReceivedTransfersTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        final transfers = walletProvider.receivedTransfers;

        if (walletProvider.isLoading && transfers.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (transfers.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.call_received, size: 64, color: Colors.grey[300]),
                const SizedBox(height: 16),
                const Text(
                  'No received transfers',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  'Incoming transfers will appear here',
                  style: TextStyle(color: Colors.grey[600]),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: _refreshWallet,
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: transfers.length,
            itemBuilder: (context, index) {
              final transfer = transfers[index];
              return _buildTransferCard(transfer, isSent: false);
            },
          ),
        );
      },
    );
  }

  Widget _buildTransferCard(dynamic transfer, {required bool isSent}) {
    final statusColor = _getStatusColor(transfer.status);
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    isSent 
                      ? 'To: ${transfer.recipientName ?? transfer.recipientEmail ?? 'User ${transfer.recipientId}'}'
                      : 'From: ${transfer.senderName ?? transfer.senderEmail ?? 'User ${transfer.senderId}'}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  'PKR ${transfer.amount.toStringAsFixed(2)}',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: Color(0xFF667eea),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (transfer.description != null && transfer.description!.isNotEmpty) ...[
              Text(
                transfer.description!,
                style: TextStyle(color: Colors.grey[600], fontSize: 13),
              ),
              const SizedBox(height: 8),
            ],
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    transfer.status.toUpperCase(),
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Text(
                  _formatDate(transfer.createdAt),
                  style: TextStyle(color: Colors.grey[400], fontSize: 11),
                ),
              ],
            ),
            if (isSent && transfer.status == 'pending') ...[
              const SizedBox(height: 12),
              const Divider(),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => _cancelTransfer(transfer.id),
                  style: TextButton.styleFrom(foregroundColor: Colors.red),
                  child: const Text('Cancel Transfer'),
                ),
              ),
            ],
            if (!isSent && transfer.status == 'pending') ...[
              const SizedBox(height: 12),
              const Divider(),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => _handleRejectTransfer(transfer.id),
                    style: TextButton.styleFrom(foregroundColor: Colors.red),
                    child: const Text('Reject'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () => _handleAcceptTransfer(transfer.id),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text('Accept'),
                  ),
                ],
              ),
            ],
            if (transfer.status == 'rejected' && transfer.rejectionReason != null) ...[
              const SizedBox(height: 8),
              Text(
                'Reason: ${transfer.rejectionReason}',
                style: const TextStyle(color: Colors.red, fontSize: 12, fontStyle: FontStyle.italic),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
        return Colors.green;
      case 'pending':
        return Colors.orange;
      case 'rejected':
        return Colors.red;
      case 'cancelled':
        return Colors.grey;
      default:
        return Colors.blue;
    }
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }

  Widget _buildHistoryTab() {
    return Consumer<WalletProvider>(
      builder: (context, walletProvider, _) {
        return Column(
          children: [
            _buildFilterBar(walletProvider),
            Expanded(
              child: _buildTransactionList(walletProvider),
            ),
          ],
        );
      },
    );
  }

  Widget _buildFilterBar(WalletProvider walletProvider) {
    final filters = ['All', 'Credit', 'Debit', 'Refund', 'Transfer'];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      child: Row(
        children: filters.map((filter) {
          final isSelected = _filterType.isEmpty && filter == 'All' ||
              _filterType.toLowerCase() == filter.toLowerCase();
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FilterChip(
              selected: isSelected,
              label: Text(filter),
              onSelected: (selected) {
                _applyFilter(filter == 'All' ? '' : filter.toLowerCase());
              },
              backgroundColor: Colors.grey.shade200,
              selectedColor: const Color(0xFF667eea),
              labelStyle: TextStyle(
                color: isSelected ? Colors.white : Colors.black87,
                fontWeight: FontWeight.w500,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildTransactionList(WalletProvider walletProvider) {
    final filteredTransactions = walletProvider.getFilteredTransactions();

    if (walletProvider.isLoading && filteredTransactions.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 40,
              height: 40,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                valueColor: AlwaysStoppedAnimation<Color>(
                  const Color(0xFF667eea).withValues(alpha: 0.8),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Loading transactions...',
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey.shade600,
              ),
            ),
          ],
        ),
      );
    }

    if (filteredTransactions.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.history,
              size: 64,
              color: Colors.grey.shade300,
            ),
            const SizedBox(height: 16),
            Text(
              'No transactions',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Colors.grey.shade600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your transaction history will appear here',
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade500,
              ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      itemCount: filteredTransactions.length +
          (walletProvider.hasMoreTransactions ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == filteredTransactions.length) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: ElevatedButton.icon(
                onPressed: _loadMoreTransactions,
                icon: const Icon(Icons.expand_more),
                label: const Text('Load More'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF667eea),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 12,
                  ),
                ),
              ),
            ),
          );
        }

        return TransactionListItem(
          transaction: filteredTransactions[index],
        );
      },
    );
  }
}
