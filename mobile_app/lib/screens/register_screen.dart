import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
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
  final _confirmPasswordController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      final fullName = _fullNameController.text.trim();
      final nameParts = fullName.split(RegExp(r'\s+'));
      final firstName = nameParts.first;
      final lastName = nameParts.length > 1
          ? nameParts.sublist(1).join(' ')
          : '';

      final needsVerification =
          await Provider.of<AuthProvider>(context, listen: false).register(
            firstName: firstName,
            lastName: lastName,
            email: _emailController.text,
            password: _passwordController.text,
            phone: _phoneController.text.isNotEmpty
                ? _phoneController.text
                : null,
            address: _addressController.text.isNotEmpty
                ? _addressController.text
                : null,
          );

      if (!mounted) return;

      if (needsVerification) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) =>
                VerificationScreen(email: _emailController.text),
          ),
        );
        return;
      }

      // Navigate to home or show success
      final auth = Provider.of<AuthProvider>(context, listen: false);
      if (auth.isAdmin) {
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil('/admin', (route) => false);
      } else if (auth.isRider) {
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil('/rider', (route) => false);
      } else {
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil('/home', (route) => false);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Registration failed: ${e.toString()}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          image: DecorationImage(
            image: const AssetImage('assets/images/login.png'),
            fit: BoxFit.fill,
            colorFilter: ColorFilter.mode(
              Colors.black.withValues(alpha: 0.3),
              BlendMode.darken,
            ),
          ),
        ),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: SingleChildScrollView(
            child: Padding(
              padding: EdgeInsets.only(
                bottom:
                    MediaQuery.of(context).size.height *
                    0.1, // Slightly less bottom padding for taller form
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(40),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    width: 350,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: const Color.fromARGB(255, 250, 250, 248),
                      borderRadius: BorderRadius.circular(40),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.2),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            'Register for ServeNow',
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                              color: Colors.black87,
                            ),
                          ),
                          const SizedBox(height: 20),
                          // Full Name
                          TextFormField(
                            controller: _fullNameController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Full Name',
                              Icons.person,
                            ),
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Required';
                              }
                              if (value.trim().split(' ').length < 2) {
                                return 'Please enter first and last name';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _emailController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Email Address',
                              Icons.email,
                            ),
                            validator: (value) =>
                                value!.isEmpty ? 'Please enter email' : null,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _passwordController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Password',
                              Icons.lock,
                            ),
                            obscureText: true,
                            validator: (value) =>
                                value!.isEmpty ? 'Please enter password' : null,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _confirmPasswordController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Confirm Password',
                              Icons.lock_outline,
                            ),
                            obscureText: true,
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Please confirm password';
                              }
                              if (value != _passwordController.text) {
                                return 'Passwords do not match';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _phoneController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Phone (Optional)',
                              Icons.phone,
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _addressController,
                            style: const TextStyle(color: Colors.black87),
                            decoration: _buildInputDecoration(
                              'Address (Optional)',
                              Icons.location_on,
                            ),
                          ),
                          const SizedBox(height: 24),
                          SizedBox(
                            width: double.infinity,
                            height: 50,
                            child: ElevatedButton(
                              onPressed:
                                  Provider.of<AuthProvider>(context).isLoading
                                  ? null
                                  : _submit,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.blueAccent,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                              child:
                                  Provider.of<AuthProvider>(context).isLoading
                                  ? const CircularProgressIndicator(
                                      color: Colors.white,
                                    )
                                  : const Text(
                                      'Register',
                                      style: TextStyle(
                                        fontSize: 18,
                                        color: Colors.white,
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          TextButton(
                            onPressed: () {
                              Navigator.of(context).pop(); // Go back to login
                            },
                            child: Text.rich(
                              TextSpan(
                                text: 'Already have an account? ',
                                style: const TextStyle(color: Colors.black54),
                                children: [
                                  TextSpan(
                                    text: 'Login here',
                                    style: TextStyle(
                                      color: Colors.blue[900],
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16,
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _buildInputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Colors.black54),
      border: const OutlineInputBorder(
        borderSide: BorderSide(color: Colors.black26),
      ),
      enabledBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: Colors.black26),
      ),
      focusedBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: Colors.blueAccent),
      ),
      prefixIcon: Icon(icon, color: Colors.black54),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      isDense: true,
    );
  }
}
