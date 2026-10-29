import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';
import 'otp_reset_verification_screen.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _emailController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
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

  Future<void> _toggleLanguage() async {
    final next = !_isUrdu;
    await CustomerLanguage.saveIsUrdu(next);
    if (!mounted) return;
    setState(() => _isUrdu = next);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).forgotPassword(_emailController.text);

      if (!mounted) return;

      Notifier.success(context, _tr('Reset OTP sent to your email'));
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (ctx) =>
              OTPResetVerificationScreen(email: _emailController.text),
        ),
      );
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLoading = context.select<AuthProvider, bool>((a) => a.isLoading);

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(
          shape: const Border(),
          actions: [
            Padding(
              padding: const EdgeInsetsDirectional.only(end: AppSpace.sm),
              child: TextButton.icon(
                onPressed: _toggleLanguage,
                icon: const Icon(Icons.translate_rounded, size: 18),
                label: Text(_isUrdu ? 'EN' : 'اردو'),
              ),
            ),
          ],
        ),
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
                          Icons.lock_reset_rounded,
                          color: AppColors.primaryPressed,
                          size: 30,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpace.xl),
                    Text(_tr('Forgot Password?'), style: AppText.h1),
                    const SizedBox(height: AppSpace.sm),
                    Text(
                      _tr(
                        "Enter your email address and we'll send you a 6-digit code to reset your password.",
                      ),
                      style: AppText.bodySecondary,
                    ),
                    const SizedBox(height: AppSpace.xxl),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.done,
                      textDirection: TextDirection.ltr,
                      autofillHints: const [AutofillHints.email],
                      onFieldSubmitted: (_) {
                        if (!isLoading) _submit();
                      },
                      decoration: InputDecoration(
                        labelText: _tr('Email Address'),
                        hintText: _tr('example@mail.com'),
                        prefixIcon: const Icon(Icons.email_outlined),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return _tr('Please enter email');
                        }
                        if (!value.contains('@')) {
                          return _tr('Enter a valid email');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.xl),
                    PrimaryButton(
                      label: _tr('Send code'),
                      loading: isLoading,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: AppSpace.md),
                    Center(
                      child: TextButton.icon(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.arrow_back_rounded, size: 18),
                        label: Text(_tr('Back to Login')),
                      ),
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
