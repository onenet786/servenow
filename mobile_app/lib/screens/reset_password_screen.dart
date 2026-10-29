import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

class ResetPasswordScreen extends StatefulWidget {
  final String token;
  const ResetPasswordScreen({super.key, required this.token});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _isUrdu = false;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_passwordController.text != _confirmPasswordController.text) {
      Notifier.error(context, _tr('Passwords do not match'));
      return;
    }

    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).resetPassword(widget.token, _passwordController.text);

      if (!mounted) return;

      Notifier.success(context, _tr('Password reset successfully!'));
      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
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
    final isLoading = context.select<AuthProvider, bool>((a) => a.isLoading);

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(shape: const Border()),
        body: SafeArea(
          top: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _formKey,
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(
                    AppSpace.xxl,
                    AppSpace.sm,
                    AppSpace.xxl,
                    AppSpace.xxl,
                  ),
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Container(
                        width: 64,
                        height: 64,
                        decoration: const BoxDecoration(
                          color: AppColors.tint100,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.key_rounded,
                          color: AppColors.primaryPressed,
                          size: 30,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpace.xl),
                    Text(_tr('Reset Password'), style: AppText.h1),
                    const SizedBox(height: AppSpace.sm),
                    Text(
                      _tr('Choose a new password for your account.'),
                      style: AppText.bodySecondary,
                    ),
                    const SizedBox(height: AppSpace.xxl),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: _tr('New Password'),
                        helperText: _tr('At least 8 characters'),
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        suffixIcon: _toggle(
                          _obscurePassword,
                          () => setState(
                            () => _obscurePassword = !_obscurePassword,
                          ),
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return _tr('Please enter password');
                        }
                        if (value.length < 8) {
                          return _tr('Minimum 8 characters');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _confirmPasswordController,
                      obscureText: _obscureConfirmPassword,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.newPassword],
                      onFieldSubmitted: (_) {
                        if (!isLoading) _submit();
                      },
                      decoration: InputDecoration(
                        labelText: _tr('Confirm Password'),
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        suffixIcon: _toggle(
                          _obscureConfirmPassword,
                          () => setState(
                            () => _obscureConfirmPassword =
                                !_obscureConfirmPassword,
                          ),
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return _tr('Please confirm password');
                        }
                        if (value != _passwordController.text) {
                          return _tr('Passwords do not match');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.xxl),
                    PrimaryButton(
                      label: _tr('Update Password'),
                      loading: isLoading,
                      onPressed: _submit,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
