import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _obscurePassword = true;
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

  Future<void> _setLanguage(bool isUrdu) async {
    await CustomerLanguage.saveIsUrdu(isUrdu);
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  Future<void> _showLanguageOptions() async {
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        Widget option(String label, bool urdu, String sample) {
          final selected = _isUrdu == urdu;
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpace.sm),
            child: Material(
              color: selected ? AppColors.tint50 : AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: AppRadius.controlAll,
                side: BorderSide(
                  color: selected ? AppColors.primary : AppColors.border,
                  width: selected ? 1.5 : 1,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  await _setLanguage(urdu);
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.lg,
                    vertical: AppSpace.md,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(label, style: AppText.bodyStrong),
                            Text(sample, style: AppText.small),
                          ],
                        ),
                      ),
                      if (selected) ...[
                        Text(
                          _tr('Selected'),
                          style: AppText.label.copyWith(
                            color: AppColors.primaryPressed,
                          ),
                        ),
                        const SizedBox(width: AppSpace.xs),
                        const Icon(
                          Icons.check_circle_rounded,
                          color: AppColors.primary,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          );
        }

        return LanguageScope(
          isUrdu: _isUrdu,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                0,
                AppSpace.gutter,
                AppSpace.lg,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_tr('Select Language'), style: AppText.h2),
                  const SizedBox(height: AppSpace.md),
                  option(_tr('English'), false, 'English'),
                  option(_tr('Urdu'), true, 'اردو'),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _goToRoleHome() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.isAdmin) {
      Navigator.of(context).pushReplacementNamed('/admin');
    } else if (auth.isRider) {
      Navigator.of(context).pushReplacementNamed('/rider');
    } else if (auth.isStoreOwner) {
      Navigator.of(context).pushReplacementNamed('/store_owner');
    } else {
      Navigator.of(context).pushReplacementNamed('/home');
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    try {
      await Provider.of<AuthProvider>(
        context,
        listen: false,
      ).login(_emailController.text, _passwordController.text);

      if (!mounted) return;
      _goToRoleHome();
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    }
  }

  Future<void> _continueAsGuest() async {
    try {
      await Provider.of<AuthProvider>(context, listen: false).guestLogin();

      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed('/home');
    } catch (e) {
      if (mounted) {
        Notifier.error(context, e.toString());
      }
    }
  }

  Future<void> _continueWithGoogle() async {
    try {
      await Provider.of<AuthProvider>(context, listen: false).loginWithGoogle();

      if (!mounted) return;
      _goToRoleHome();
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
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.xxl,
                  AppSpace.lg,
                  AppSpace.xxl,
                  AppSpace.xxl,
                ),
                children: [
                  Row(
                    children: [
                      const _BrandMark(),
                      const Spacer(),
                      _LanguagePill(
                        isUrdu: _isUrdu,
                        onTap: _showLanguageOptions,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpace.xxxl),
                  Text(_tr('Welcome Back'), style: AppText.display),
                  const SizedBox(height: AppSpace.xs),
                  Text(
                    _tr('Sign in to order groceries, food and more.'),
                    style: AppText.bodySecondary,
                  ),
                  const SizedBox(height: AppSpace.xxl),
                  Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.email],
                          textDirection: TextDirection.ltr,
                          decoration: InputDecoration(
                            labelText: _tr('Email Address'),
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
                        const SizedBox(height: AppSpace.md),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) {
                            if (!isLoading) _submit();
                          },
                          decoration: InputDecoration(
                            labelText: _tr('Password'),
                            prefixIcon: const Icon(Icons.lock_outline_rounded),
                            suffixIcon: IconButton(
                              tooltip: _obscurePassword
                                  ? _tr('Show password')
                                  : _tr('Hide password'),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                              ),
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                            ),
                          ),
                          validator: (value) => value == null || value.isEmpty
                              ? _tr('Please enter password')
                              : null,
                        ),
                      ],
                    ),
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TextButton(
                      onPressed: () =>
                          Navigator.of(context).pushNamed('/forgot-password'),
                      child: Text(_tr('Forgot Password?')),
                    ),
                  ),
                  const SizedBox(height: AppSpace.sm),
                  PrimaryButton(
                    label: _tr('Log in'),
                    loading: isLoading,
                    onPressed: _submit,
                  ),
                  const SizedBox(height: AppSpace.xl),
                  Row(
                    children: [
                      const Expanded(child: Divider()),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpace.md,
                        ),
                        child: Text(_tr('or'), style: AppText.caption),
                      ),
                      const Expanded(child: Divider()),
                    ],
                  ),
                  const SizedBox(height: AppSpace.xl),
                  SizedBox(
                    height: 52,
                    child: OutlinedButton(
                      onPressed: isLoading ? null : _continueWithGoogle,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.text,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(
                            width: 22,
                            height: 22,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.border),
                            ),
                            child: const Text(
                              'G',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w800,
                                color: AppColors.info,
                                height: 1.1,
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpace.sm),
                          Flexible(
                            child: Text(
                              _tr('Continue with Google'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  SizedBox(
                    height: 52,
                    child: OutlinedButton.icon(
                      onPressed: isLoading ? null : _continueAsGuest,
                      icon: const Icon(Icons.person_outline_rounded),
                      label: Text(_tr('Continue as Guest')),
                    ),
                  ),
                  const SizedBox(height: AppSpace.xxl),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        _tr("Don't have an account? "),
                        style: AppText.bodySecondary,
                      ),
                      TextButton(
                        onPressed: () =>
                            Navigator.of(context).pushNamed('/register'),
                        child: Text(_tr('Register Here')),
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

/// Small app icon + wordmark.
class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.asset(
            'assets/icon/servenow_brand_logo_v2.png',
            width: 40,
            height: 40,
            cacheWidth: 120,
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (context, error, stack) => Container(
              width: 40,
              height: 40,
              color: AppColors.primary,
              alignment: Alignment.center,
              child: const Icon(Icons.shopping_cart_outlined,
                  color: Colors.white, size: 22),
            ),
          ),
        ),
        const SizedBox(width: AppSpace.sm),
        const Text(
          'ServeNow',
          textDirection: TextDirection.ltr,
          style: TextStyle(
            fontFamily: AppText.latinFamily,
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.text,
            letterSpacing: -0.2,
          ),
        ),
      ],
    );
  }
}

/// Visible language switch: "EN" / "اردو".
class _LanguagePill extends StatelessWidget {
  final bool isUrdu;
  final VoidCallback onTap;

  const _LanguagePill({required this.isUrdu, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.translate_rounded, size: 18),
      label: Text(isUrdu ? 'اردو' : 'EN'),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        foregroundColor: AppColors.primaryPressed,
        side: const BorderSide(color: AppColors.border),
        shape: const StadiumBorder(),
      ),
    );
  }
}
