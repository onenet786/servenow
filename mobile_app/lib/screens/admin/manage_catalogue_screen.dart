import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';

class ManageCatalogueScreen extends StatefulWidget {
  const ManageCatalogueScreen({super.key});

  @override
  State<ManageCatalogueScreen> createState() => _ManageCatalogueScreenState();
}

class _ManageCatalogueScreenState extends State<ManageCatalogueScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Manage Catalogue'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Categories'),
            Tab(text: 'Units'),
            Tab(text: 'Sizes'),
          ],
          labelColor: Colors.black,
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          ManageCategoriesTab(),
          ManageUnitsTab(),
          ManageSizesTab(),
        ],
      ),
    );
  }
}

class ManageCategoriesTab extends StatefulWidget {
  const ManageCategoriesTab({super.key});

  @override
  State<ManageCategoriesTab> createState() => _ManageCategoriesTabState();
}

class _ManageCategoriesTabState extends State<ManageCategoriesTab> {
  List<dynamic> _categories = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await ApiService.getCategories();
      if (!mounted) return;
      setState(() {
        _categories = categories;
        _isLoading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showDialog({Map<String, dynamic>? item}) {
    final nameController = TextEditingController(text: item?['name'] ?? '');
    final descController = TextEditingController(
      text: item?['description'] ?? '',
    );
    bool isActive = item?['is_active'] == 1 || item?['is_active'] == true;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) {
          return AlertDialog(
            title: Text(item == null ? 'Add Category' : 'Edit Category'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
                if (item != null)
                  SwitchListTile(
                    title: const Text('Active'),
                    value: isActive,
                    onChanged: (val) => setState(() => isActive = val),
                  ),
              ],
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
                    'name': nameController.text,
                    'description': descController.text,
                    if (item != null) 'is_active': isActive,
                  };
                  try {
                    if (item == null) {
                      await ApiService.createCategory(token, data);
                    } else {
                      await ApiService.updateCategory(token, item['id'], data);
                    }
                    if (!context.mounted) return;
                    Navigator.pop(context);
                    _loadCategories();
                  } catch (e) {
                    // handle error
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
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showDialog(),
        child: const Icon(Icons.add),
      ),
      body: ListView.builder(
        itemCount: _categories.length,
        itemBuilder: (context, index) {
          final item = _categories[index];
          return ListTile(
            title: Text(item['name'] ?? ''),
            subtitle: Text(item['description'] ?? ''),
            trailing: IconButton(
              icon: const Icon(Icons.edit),
              onPressed: () => _showDialog(item: item),
            ),
          );
        },
      ),
    );
  }
}

class ManageUnitsTab extends StatefulWidget {
  const ManageUnitsTab({super.key});

  @override
  State<ManageUnitsTab> createState() => _ManageUnitsTabState();
}

class _ManageUnitsTabState extends State<ManageUnitsTab> {
  List<dynamic> _units = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadUnits();
  }

  Future<void> _loadUnits() async {
    try {
      final units = await ApiService.getUnits();
      if (!mounted) return;
      setState(() {
        _units = units;
        _isLoading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showDialog({Map<String, dynamic>? item}) {
    final nameController = TextEditingController(text: item?['name'] ?? '');
    final abbrevController = TextEditingController(
      text: item?['abbreviation'] ?? '',
    );

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(item == null ? 'Add Unit' : 'Edit Unit'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            TextField(
              controller: abbrevController,
              decoration: const InputDecoration(labelText: 'Abbreviation'),
            ),
          ],
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
                'name': nameController.text,
                'abbreviation': abbrevController.text,
              };
              try {
                if (item == null) {
                  await ApiService.createUnit(token, data);
                } else {
                  await ApiService.updateUnit(token, item['id'], data);
                }
                if (!context.mounted) return;
                Navigator.pop(context);
                _loadUnits();
              } catch (e) {
                // handle error
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteUnit(int id) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    await ApiService.deleteUnit(token, id);
    if (!mounted) return;
    _loadUnits();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showDialog(),
        child: const Icon(Icons.add),
      ),
      body: ListView.builder(
        itemCount: _units.length,
        itemBuilder: (context, index) {
          final item = _units[index];
          return ListTile(
            title: Text(item['name'] ?? ''),
            subtitle: Text(item['abbreviation'] ?? ''),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit),
                  onPressed: () => _showDialog(item: item),
                ),
                IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  onPressed: () => _deleteUnit(item['id']),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class ManageSizesTab extends StatefulWidget {
  const ManageSizesTab({super.key});

  @override
  State<ManageSizesTab> createState() => _ManageSizesTabState();
}

class _ManageSizesTabState extends State<ManageSizesTab> {
  List<dynamic> _sizes = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSizes();
  }

  Future<void> _loadSizes() async {
    try {
      final sizes = await ApiService.getSizes();
      if (!mounted) return;
      setState(() {
        _sizes = sizes;
        _isLoading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showDialog({Map<String, dynamic>? item}) {
    final nameController = TextEditingController(text: item?['name'] ?? '');
    final sortOrderController = TextEditingController(
      text: item?['sort_order']?.toString() ?? '0',
    );

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(item == null ? 'Add Size' : 'Edit Size'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            TextField(
              controller: sortOrderController,
              decoration: const InputDecoration(labelText: 'Sort Order'),
              keyboardType: TextInputType.number,
            ),
          ],
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
                'name': nameController.text,
                'sort_order': int.tryParse(sortOrderController.text) ?? 0,
              };
              try {
                if (item == null) {
                  await ApiService.createSize(token, data);
                } else {
                  await ApiService.updateSize(token, item['id'], data);
                }
                if (!context.mounted) return;
                Navigator.pop(context);
                _loadSizes();
              } catch (e) {
                // handle error
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteSize(int id) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    await ApiService.deleteSize(token, id);
    if (!mounted) return;
    _loadSizes();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showDialog(),
        child: const Icon(Icons.add),
      ),
      body: ListView.builder(
        itemCount: _sizes.length,
        itemBuilder: (context, index) {
          final item = _sizes[index];
          return ListTile(
            title: Text(item['name'] ?? ''),
            subtitle: Text('Sort Order: ${item['sort_order']}'),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit),
                  onPressed: () => _showDialog(item: item),
                ),
                IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  onPressed: () => _deleteSize(item['id']),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
