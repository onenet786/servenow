import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';
import 'reset_password_screen.dart';

class OTPResetVerificationScreen extends StatefulWidget {
  final String email;
  const OTPResetVerificationScreen({super.key, required this.email});

  @override
  State<OTPResetVerificationScreen> createState() =>
      _OTPResetVerificationScreenState();
}

class _OTPResetVerificationScreenState
    extends State<OTPResetVerificationScreen> {
  final _codeController = TextEditingController();
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
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_codeController.text.length != 6) {
      Notifier.error(context, _tr('Please enter a 6-digit code'));
      return;
    }

    try {
      final resetToken = await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).verifyResetOTP(widget.email, _codeController.text);

      if (!mounted) return;

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (ctx) => ResetPasswordScreen(token: resetToken),
        ),
      );
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    }
  }

  Future<void> _resend() async {
    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).forgotPassword(widget.email);
      if (!mounted) return;
      Notifier.success(context, _tr('Reset code sent again'));
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
        appBar: AppBar(shape: const Border()),
        body: SafeArea(
          top: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
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
                        Icons.password_rounded,
                        color: AppColors.primaryPressed,
                        size: 30,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpace.xl),
                  Text(_tr('Enter reset code'), style: AppText.h1),
                  const SizedBox(height: AppSpace.sm),
                  Text(
                    _tr('We sent a 6-digit password reset code to'),
                    style: AppText.bodySecondary,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    Fmt.isolate(widget.email),
                    style: AppText.bodyStrong,
                  ),
                  const SizedBox(height: AppSpace.xxl),
                  TextField(
                    controller: _codeController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    textAlign: TextAlign.center,
                    textDirection: TextDirection.ltr,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onSubmitted: (_) {
                      if (!isLoading) _verify();
                    },
                    style: AppText.h1.copyWith(
                      letterSpacing: 10,
                      fontFeatures: AppText.tabular,
                    ),
                    decoration: InputDecoration(
                      hintText: '000000',
                      counterText: '',
                      hintStyle: AppText.h1.copyWith(
                        letterSpacing: 10,
                        color: AppColors.borderStrong,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpace.xl),
                  PrimaryButton(
                    label: _tr('Verify code'),
                    loading: isLoading,
                    onPressed: _verify,
                  ),
                  const SizedBox(height: AppSpace.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        _tr("Didn't receive the code?"),
                        style: AppText.bodySecondary,
                      ),
                      TextButton(
                        onPressed: isLoading ? null : _resend,
                        child: Text(_tr('Resend Code')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
