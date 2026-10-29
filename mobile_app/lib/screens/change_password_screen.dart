import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _currentPasswordController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _isUrdu = false;
  bool _obscureCurrent = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
  }

  /// Urdu only for customers / guests; staff screens stay English.
  Future<void> _loadLanguagePreference() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final isStaff = auth.isAdmin || auth.isRider || auth.isStoreOwner;
    if (isStaff) return;
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  @override
  void dispose() {
    _currentPasswordController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      await Provider.of<AuthProvider>(context, listen: false).changePassword(
        _currentPasswordController.text,
        _newPasswordController.text,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_tr('Password changed successfully'))),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Widget _toggle(bool obscured, VoidCallback onPressed) {
    return IconButton(
      tooltip: obscured ? _tr('Show password') : _tr('Hide password'),
      icon: Icon(
        obscured ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      ),
      onPressed: onPressed,
    );
  }

  @override
  Widget build(BuildContext context) {
    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        appBar: AppBar(title: Text(_tr('Change Password'))),
        body: SafeArea(
          top: false,
          child: Form(
            key: _formKey,
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.all(AppSpace.gutter),
              children: [
                AppCard(
                  padding: const EdgeInsets.all(AppSpace.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            decoration: const BoxDecoration(
                              color: AppColors.tint100,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.shield_outlined,
                              color: AppColors.primaryPressed,
                              size: 20,
                            ),
                          ),
                          const SizedBox(width: AppSpace.md),
                          Expanded(
                            child: Text(
                              _tr(
                                'Use at least 8 characters. A mix of letters and numbers is safer.',
                              ),
                              style: AppText.small,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpace.lg),
                      TextFormField(
                        controller: _currentPasswordController,
                        obscureText: _obscureCurrent,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: _tr('Current Password'),
                          prefixIcon: const Icon(Icons.lock_outline_rounded),
                          suffixIcon: _toggle(
                            _obscureCurrent,
                            () => setState(
                              () => _obscureCurrent = !_obscureCurrent,
                            ),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return _tr('Please enter current password');
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: AppSpace.md),
                      TextFormField(
                        controller: _newPasswordController,
                        obscureText: _obscureNew,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.newPassword],
                        decoration: InputDecoration(
                          labelText: _tr('New Password'),
                          prefixIcon: const Icon(Icons.key_outlined),
                          suffixIcon: _toggle(
                            _obscureNew,
                            () => setState(() => _obscureNew = !_obscureNew),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return _tr('Please enter new password');
                          }
                          if (value.length < 8) {
                            return _tr('Password must be at least 8 characters');
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: AppSpace.md),
                      TextFormField(
                        controller: _confirmPasswordController,
                        obscureText: _obscureConfirm,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.newPassword],
                        onFieldSubmitted: (_) {
                          if (!_isLoading) _submit();
                        },
                        decoration: InputDecoration(
                          labelText: _tr('Confirm New Password'),
                          prefixIcon: const Icon(Icons.key_outlined),
                          suffixIcon: _toggle(
                            _obscureConfirm,
                            () => setState(
                              () => _obscureConfirm = !_obscureConfirm,
                            ),
                          ),
                        ),
                        validator: (value) {
                          if (value != _newPasswordController.text) {
                            return _tr('Passwords do not match');
                          }
                          return null;
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.xl),
                PrimaryButton(
                  label: _tr('Update Password'),
                  loading: _isLoading,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
