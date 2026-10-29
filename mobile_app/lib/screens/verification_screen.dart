import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

class VerificationScreen extends StatefulWidget {
  final String email;
  const VerificationScreen({super.key, required this.email});

  @override
  State<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends State<VerificationScreen> {
  final _codeController = TextEditingController();
  bool _isLoading = false;
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Please enter a 6-digit code'))),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      await Provider.of<AuthProvider>(context, listen: false).verifyEmail(
        widget.email,
        _codeController.text,
      );
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Email verified! Please login.'))),
      );

      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _isLoading = true);
    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).resendCode(widget.email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Verification code sent!'))),
      );
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.xxl,
                  AppSpace.sm,
                  AppSpace.xxl,
                  AppSpace.xxl,
                ),
                children: [
                  const _CodeIcon(icon: Icons.mark_email_read_outlined),
                  const SizedBox(height: AppSpace.xl),
                  Text(_tr('Verify Email'), style: AppText.h1),
                  const SizedBox(height: AppSpace.sm),
                  Text(
                    _tr('Please enter the 6-digit code sent to'),
                    style: AppText.bodySecondary,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    Fmt.isolate(widget.email),
                    style: AppText.bodyStrong,
                  ),
                  const SizedBox(height: AppSpace.xxl),
                  _CodeField(
                    controller: _codeController,
                    label: _tr('Verification code'),
                    onSubmitted: _isLoading ? null : _verify,
                  ),
                  const SizedBox(height: AppSpace.xl),
                  PrimaryButton(
                    label: _tr('Verify'),
                    loading: _isLoading,
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
                        onPressed: _isLoading ? null : _resend,
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

/// Tinted circle with an icon at the top of code-entry screens.
class _CodeIcon extends StatelessWidget {
  final IconData icon;
  const _CodeIcon({required this.icon});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Container(
        width: 64,
        height: 64,
        decoration: const BoxDecoration(
          color: AppColors.tint100,
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: AppColors.primaryPressed, size: 30),
      ),
    );
  }
}

/// Large, spaced 6-digit code input.
class _CodeField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final VoidCallback? onSubmitted;

  const _CodeField({
    required this.controller,
    required this.label,
    this.onSubmitted,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
      maxLength: 6,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onSubmitted: (_) => onSubmitted?.call(),
      style: AppText.h1.copyWith(
        letterSpacing: 10,
        fontFeatures: AppText.tabular,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: '000000',
        counterText: '',
        hintStyle: AppText.h1.copyWith(
          letterSpacing: 10,
          color: AppColors.borderStrong,
        ),
      ),
    );
  }
}
