import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_text.dart';

/// Marks the employee's attendance: the location first, then a live photo from
/// the front camera. Both are required on a phone. The server decides whether
/// this is a check in or a check out.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  bool _loading = true;
  bool _saving = false;
  String? _name;
  String? _designation;
  String? _nextAction;
  String? _message;
  bool _messageIsGood = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    try {
      final data = await ApiService.getMyAttendance(token);
      if (!mounted) return;
      final employee = data['employee'];
      setState(() {
        _loading = false;
        if (employee is Map) {
          _name = employee['name']?.toString();
          _designation = employee['designation']?.toString();
          _nextAction = data['next_action']?.toString();
          if (_nextAction == 'done') {
            _message = 'Your attendance for today is complete.';
            _messageIsGood = true;
          }
        } else {
          _message = 'You are not on the staff list yet. Ask HR to add you.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _message = 'Could not load your attendance. Please try again.';
      });
    }
  }

  /// The current position, or null after telling the person what to fix.
  Future<Position?> _position() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _show('Turn on location on your phone, then try again.');
      await Geolocator.openLocationSettings();
      return null;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      _show('Allow location for ServeNow to mark attendance.');
      return null;
    }
    if (permission == LocationPermission.deniedForever) {
      _show('Allow location for ServeNow in your phone settings.');
      await Geolocator.openAppSettings();
      return null;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    if (position.isMocked) {
      _show('A fake location app is on. Turn it off to mark attendance.');
      return null;
    }
    return position;
  }

  void _show(String message, {bool good = false}) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _messageIsGood = good;
    });
  }

  Future<void> _mark() async {
    final token = context.read<AuthProvider>().token;
    if (token == null || _saving) return;
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      final position = await _position();
      if (position == null) return;
      final photo = await ImagePicker().pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        maxWidth: 640,
        imageQuality: 70,
        requestFullMetadata: false,
      );
      if (photo == null) {
        _show('Take your photo to mark attendance.');
        return;
      }
      final bytes = await photo.readAsBytes();
      final data = await ApiService.markAttendance(
        token,
        photo: 'data:image/jpeg;base64,${base64Encode(bytes)}',
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
      );
      if (!mounted) return;
      setState(() {
        _nextAction = data['action'] == 'in' ? 'out' : 'done';
      });
      _show(data['message']?.toString() ?? 'Saved.', good: true);
    } catch (e) {
      _show(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canMark = _nextAction == 'in' || _nextAction == 'out';
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(AppSpace.lg),
              children: [
                if (_name != null) Text(_name!, style: AppText.h1),
                if (_designation != null && _designation!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(_designation!, style: AppText.bodySecondary),
                ],
                const SizedBox(height: AppSpace.lg),
                if (_message != null)
                  Text(
                    _message!,
                    style: AppText.body.copyWith(
                      color: _messageIsGood
                          ? AppColors.success
                          : AppColors.danger,
                    ),
                  ),
                if (canMark) ...[
                  const SizedBox(height: AppSpace.lg),
                  Text(
                    'Keep location on. Your photo is taken with the front camera.',
                    style: AppText.small,
                  ),
                  const SizedBox(height: AppSpace.md),
                  FilledButton.icon(
                    onPressed: _saving ? null : _mark,
                    icon: const Icon(Icons.camera_alt_rounded),
                    label: Text(
                      _saving
                          ? 'Saving...'
                          : _nextAction == 'out'
                          ? 'Check Out'
                          : 'Check In',
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}
