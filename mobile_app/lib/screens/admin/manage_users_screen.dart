import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';

class ManageUsersScreen extends StatefulWidget {
  const ManageUsersScreen({super.key});

  @override
  State<ManageUsersScreen> createState() => _ManageUsersScreenState();
}

class _ManageUsersScreenState extends State<ManageUsersScreen> {
  List<dynamic> _users = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      final users = await ApiService.getUsers(token);
      setState(() {
        _users = users;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading users: $e')));
      }
    }
  }

  void _showUserDialog({Map<String, dynamic>? user}) {
    final firstNameController = TextEditingController(
      text: user?['first_name'] ?? '',
    );
    final lastNameController = TextEditingController(
      text: user?['last_name'] ?? '',
    );
    final emailController = TextEditingController(text: user?['email'] ?? '');
    final phoneController = TextEditingController(text: user?['phone'] ?? '');
    final userTypeController = TextEditingController(
      text: user?['user_type'] ?? 'customer',
    );
    bool isActive = user?['is_active'] == 1 || user?['is_active'] == true;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) {
          return AlertDialog(
            title: Text(user == null ? 'Add User' : 'Edit User'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: firstNameController,
                    decoration: const InputDecoration(labelText: 'First Name'),
                  ),
                  TextField(
                    controller: lastNameController,
                    decoration: const InputDecoration(labelText: 'Last Name'),
                  ),
                  TextField(
                    controller: emailController,
                    decoration: const InputDecoration(labelText: 'Email'),
                    enabled: user == null,
                  ),
                  TextField(
                    controller: phoneController,
                    decoration: const InputDecoration(labelText: 'Phone'),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue:
                        [
                          'customer',
                          'store_owner',
                          'admin',
                        ].contains(userTypeController.text)
                        ? userTypeController.text
                        : 'customer',
                    decoration: const InputDecoration(labelText: 'User Type'),
                    items: const [
                      DropdownMenuItem(
                        value: 'customer',
                        child: Text('Customer'),
                      ),
                      DropdownMenuItem(
                        value: 'store_owner',
                        child: Text('Store Owner'),
                      ),
                      DropdownMenuItem(value: 'admin', child: Text('Admin')),
                    ],
                    onChanged: (val) {
                      userTypeController.text = val!;
                    },
                  ),
                  CheckboxListTile(
                    title: const Text('Is Active'),
                    value: isActive,
                    onChanged: (val) {
                      setState(() {
                        isActive = val ?? false;
                      });
                    },
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () async {
                  final token = Provider.of<AuthProvider>(
                    context,
                    listen: false,
                  ).token;
                  if (token == null) return;

                  final data = {
                    'firstName': firstNameController.text,
                    'lastName': lastNameController.text,
                    'email': emailController.text,
                    'phone': phoneController.text,
                    'user_type': userTypeController.text,
                    'is_active': isActive,
                  };

                  try {
                    if (user == null) {
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Create user not implemented yet'),
                        ),
                      );
                    } else {
                      await ApiService.updateUser(token, user['id'], data);
                      if (!context.mounted) return;
                      Navigator.pop(context);
                      _loadUsers();
                    }
                  } catch (e) {
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Error saving user: $e')),
                    );
                  }
                },
                child: const Text('Save'),
              ),
            ],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Manage Users')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              itemCount: _users.length,
              itemBuilder: (context, index) {
                final user = _users[index];
                return ListTile(
                  title: Text('${user['first_name']} ${user['last_name']}'),
                  subtitle: Text('${user['email']} (${user['user_type']})'),
                  trailing: IconButton(
                    icon: const Icon(Icons.edit, color: Colors.blue),
                    onPressed: () => _showUserDialog(user: user),
                  ),
                );
              },
            ),
    );
  }
}
