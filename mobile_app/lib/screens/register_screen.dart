import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';
import 'verification_screen.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _dobController = TextEditingController();

  /// Holds only the 9 digits after the fixed "+92 3" prefix.
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  DateTime? _selectedDob;
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

  /// The value sent to the server: "+923" followed by the 9 typed digits
  /// (same format as before; the prefix is now fixed instead of editable).
  String get _fullPhone => '+923${_phoneController.text.trim()}';

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _dobController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    try {
      final fullName = _fullNameController.text.trim();
      final nameParts = fullName.isEmpty
          ? <String>[]
          : fullName.split(RegExp(r'\s+'));
      final firstName = nameParts.isNotEmpty ? nameParts.first : fullName;
      final lastName = nameParts.length > 1
          ? nameParts.sublist(1).join(' ')
          : fullName;

      final requiresVerification =
          await Provider.of<AuthProvider>(context, listen: false).register(
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: _dobController.text,
            email: _emailController.text,
            password: _passwordController.text,
            phone: _fullPhone,
            address: _addressController.text,
          );

      if (!mounted) return;

      if (requiresVerification) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (ctx) => VerificationScreen(email: _emailController.text),
          ),
        );
        return;
      }

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
          title: Text(_tr('Create account')),
          shape: const Border(),
          actions: [
            Padding(
              padding: const EdgeInsetsDirectional.only(end: AppSpace.md),
              child: Center(
                child: LanguageToggle(isUrdu: _isUrdu, onChanged: _setLanguage),
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
                    Text(_tr('Register for ServeNow'), style: AppText.h1),
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      _tr('It takes less than a minute.'),
                      style: AppText.bodySecondary,
                    ),
                    const SizedBox(height: AppSpace.xxl),
                    TextFormField(
                      controller: _fullNameController,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const [AutofillHints.name],
                      decoration: InputDecoration(
                        labelText: _tr('Full Name'),
                        prefixIcon: const Icon(Icons.person_outline_rounded),
                      ),
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) {
                          return _tr('Full name is required');
                        }
                        if (trimmed.length < 2) {
                          return _tr('Full name is too short');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      textDirection: TextDirection.ltr,
                      autofillHints: const [AutofillHints.email],
                      decoration: InputDecoration(
                        labelText: _tr('Email Address'),
                        prefixIcon: const Icon(Icons.email_outlined),
                      ),
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) {
                          return _tr('Email is required');
                        }
                        if (!trimmed.contains('@')) {
                          return _tr('Enter a valid email');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _passwordController,
                      textInputAction: TextInputAction.next,
                      obscureText: _obscurePassword,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: _tr('Password'),
                        helperText: _tr('At least 8 characters'),
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
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) {
                          return _tr('Password is required');
                        }
                        if (trimmed.length < 8) {
                          return _tr('Password must be at least 8 characters');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _dobController,
                      readOnly: true,
                      decoration: InputDecoration(
                        labelText: _tr('Date of Birth'),
                        prefixIcon: const Icon(Icons.cake_outlined),
                        suffixIcon: IconButton(
                          tooltip: _tr('Select date of birth'),
                          icon: const Icon(Icons.calendar_today_outlined),
                          onPressed: () => _selectDob(context),
                        ),
                      ),
                      onTap: () => _selectDob(context),
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) {
                          return _tr('Date of birth is required');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.next,
                      textDirection: TextDirection.ltr,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      inputFormatters: [_PakistanMobileSuffixFormatter()],
                      decoration: InputDecoration(
                        labelText: _tr('Phone Number'),
                        hintText: '001234567',
                        prefixIcon: const Icon(Icons.phone_outlined),
                        prefix: Text(
                          '+92 3 ',
                          textDirection: TextDirection.ltr,
                          style: AppText.body.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        helperText: _tr('Pakistan mobile number'),
                      ),
                      validator: (_) {
                        if (_phoneController.text.trim().isEmpty) {
                          return _tr('Phone number is required');
                        }
                        if (!RegExp(r'^\+923\d{9}$').hasMatch(_fullPhone)) {
                          return _tr('Use +923 followed by 9 digits');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    TextFormField(
                      controller: _addressController,
                      textInputAction: TextInputAction.done,
                      minLines: 1,
                      maxLines: 3,
                      autofillHints: const [AutofillHints.fullStreetAddress],
                      decoration: InputDecoration(
                        labelText: _tr('Address'),
                        prefixIcon: const Icon(Icons.location_on_outlined),
                      ),
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) {
                          return _tr('Address is required');
                        }
                        if (trimmed.length < 4) {
                          return _tr('Address is too short');
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpace.xxl),
                    PrimaryButton(
                      label: _tr('Register'),
                      loading: isLoading,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: AppSpace.md),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: Text(_tr('Already have an account? Login here')),
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

  Future<void> _selectDob(BuildContext context) async {
    FocusScope.of(context).unfocus();
    final today = DateTime.now();
    final initialDate =
        _selectedDob ?? DateTime(today.year - 18, today.month, today.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(1900, 1, 1),
      lastDate: today,
      initialEntryMode: DatePickerEntryMode.calendar,
      helpText: _tr('Select date of birth'),
      cancelText: _tr('Cancel'),
      confirmText: _tr('Select'),
    );
    if (picked == null) return;
    setState(() {
      _selectedDob = picked;
      _dobController.text = _formatDate(picked);
    });
  }

  String _formatDate(DateTime date) {
    final year = date.year.toString().padLeft(4, '0');
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }
}

/// Keeps only the 9 digits after "+92 3". Pasted full numbers such as
/// "+923001234567", "923001234567" or "03001234567" are reduced to the
/// suffix, so the submitted value is always "+923" + 9 digits.
class _PakistanMobileSuffixFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    var digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length > 9) {
      if (digits.startsWith('923')) {
        digits = digits.substring(3);
      } else if (digits.startsWith('03')) {
        digits = digits.substring(2);
      } else if (digits.startsWith('3')) {
        digits = digits.substring(1);
      }
    }
    if (digits.length > 9) digits = digits.substring(0, 9);
    return TextEditingValue(
      text: digits,
      selection: TextSelection.collapsed(offset: digits.length),
    );
  }
}
