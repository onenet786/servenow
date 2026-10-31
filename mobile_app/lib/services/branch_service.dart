import 'dart:convert';

import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';

/// One ServeNow branch (a city).
class Branch {
  final int id;
  final String name;
  final double? latitude;
  final double? longitude;

  const Branch({
    required this.id,
    required this.name,
    this.latitude,
    this.longitude,
  });

  factory Branch.fromJson(Map<String, dynamic> json) => Branch(
    id: int.parse('${json['id']}'),
    name: (json['name'] ?? '').toString(),
    latitude: double.tryParse('${json['center_latitude']}'),
    longitude: double.tryParse('${json['center_longitude']}'),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'center_latitude': latitude,
    'center_longitude': longitude,
  };
}

/// The open branches, and the city chosen by someone without an account.
///
/// A signed-in customer's branch comes from their account and the server
/// enforces it. The saved choice is only used by guests and for sign-up.
class BranchService {
  BranchService._();

  static const String _cacheKey = 'branches_cache_v1';
  static const String _selectedKey = 'selected_branch_id';
  static const Duration _ttl = Duration(minutes: 5);
  static const LatLng kotAdduCenter = LatLng(30.4686, 70.9661);

  static List<Branch> _open = const [];
  static Map<int, String> _names = const {};
  static DateTime? _loadedAt;
  static int? _selectedId;
  static bool _selectionRead = false;

  /// Set by `AuthProvider`: the signed-in account's branch, if it has one.
  static int? Function()? readAccountBranch;

  static List<Branch> get open => _open;
  static bool get hasChoice => _open.length > 1;
  static int? get selectedId => _selectedId;

  static Future<void> _readSelection() async {
    if (_selectionRead) return;
    final prefs = await SharedPreferences.getInstance();
    _selectedId = prefs.getInt(_selectedKey);
    _selectionRead = true;
    ApiService.browseBranchId = _selectedId;
  }

  /// Open branches, from the server or the last saved copy when offline.
  static Future<List<Branch>> load({bool force = false}) async {
    await _readSelection();
    final loadedAt = _loadedAt;
    if (!force &&
        loadedAt != null &&
        DateTime.now().difference(loadedAt) < _ttl) {
      return _open;
    }
    final prefs = await SharedPreferences.getInstance();
    try {
      final rows = await ApiService.getBranches();
      _open = rows
          .map((row) => Branch.fromJson(Map<String, dynamic>.from(row as Map)))
          .toList();
      _loadedAt = DateTime.now();
      await prefs.setString(
        _cacheKey,
        jsonEncode(_open.map((b) => b.toJson()).toList()),
      );
    } catch (_) {
      if (_open.isEmpty) {
        final saved = prefs.getString(_cacheKey);
        if (saved != null) {
          try {
            _open = (jsonDecode(saved) as List<dynamic>)
                .map((row) => Branch.fromJson(row as Map<String, dynamic>))
                .toList();
          } catch (_) {
            _open = const [];
          }
        }
      }
    }
    // A saved city that has since closed is no longer a valid choice.
    final selected = _selectedId;
    if (_open.isNotEmpty &&
        selected != null &&
        !_open.any((b) => b.id == selected)) {
      await select(null);
    }
    return _open;
  }

  static Future<void> select(int? id) async {
    _selectedId = id;
    _selectionRead = true;
    ApiService.browseBranchId = id;
    final prefs = await SharedPreferences.getInstance();
    if (id == null) {
      await prefs.remove(_selectedKey);
    } else {
      await prefs.setInt(_selectedKey, id);
    }
  }

  /// Names for staff screens, including closed branches for head office.
  static Future<Map<int, String>> loadStaffNames(String token) async {
    try {
      final rows = await ApiService.getBranchOptions(token);
      _names = {
        for (final row in rows)
          int.parse('${row['id']}'): (row['name'] ?? '').toString(),
      };
    } catch (_) {
      await load();
      _names = {for (final b in _open) b.id: b.name};
    }
    return _names;
  }

  static String nameOf(dynamic id) {
    final key = int.tryParse('$id');
    if (key == null) return '';
    return _names[key] ??
        _open.where((b) => b.id == key).map((b) => b.name).firstOrNull ??
        'Branch $key';
  }

  /// Map centre when nothing better is known: the account's branch, then the
  /// chosen city, then the first open branch, then Kot Addu.
  static LatLng get defaultCenter {
    final account = readAccountBranch?.call();
    final candidates = <Branch?>[
      _open.where((b) => b.id == account).firstOrNull,
      _open.where((b) => b.id == _selectedId).firstOrNull,
      _open.firstOrNull,
    ];
    for (final branch in candidates) {
      final lat = branch?.latitude;
      final lng = branch?.longitude;
      if (lat != null && lng != null) return LatLng(lat, lng);
    }
    return kotAdduCenter;
  }
}
