import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/staff/staff_ui.dart';

class OfferCampaignsScreen extends StatefulWidget {
  final bool isAdmin;
  final int? initialStoreId;

  const OfferCampaignsScreen({
    super.key,
    required this.isAdmin,
    this.initialStoreId,
  });

  @override
  State<OfferCampaignsScreen> createState() => _OfferCampaignsScreenState();
}

class _OfferCampaignsScreenState extends State<OfferCampaignsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _discountValueCtrl = TextEditingController();
  final _buyQtyCtrl = TextEditingController(text: '1');
  final _getQtyCtrl = TextEditingController(text: '1');

  bool _loading = false;
  bool _saving = false;
  bool _enabled = true;
  String _campaignType = 'discount';
  String _discountType = 'percent';
  String _scope = 'all_products';
  DateTime _startAt = DateTime.now();
  DateTime _endAt = DateTime.now().add(const Duration(hours: 1));
  int? _selectedStoreId;
  int? _editingCampaignId;

  List<dynamic> _stores = [];
  List<dynamic> _products = [];
  List<dynamic> _campaigns = [];
  final Set<int> _selectedProductIds = <int>{};

  @override
  void initState() {
    super.initState();
    _selectedStoreId = widget.initialStoreId;
    _loadInitial();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _discountValueCtrl.dispose();
    _buyQtyCtrl.dispose();
    _getQtyCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final token = auth.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      if (widget.isAdmin) {
        _stores = await ApiService.getStoresForAdmin(
          token,
          includeInactive: true,
          lite: true,
        );
        if (_selectedStoreId == null && _stores.isNotEmpty) {
          _selectedStoreId = int.tryParse('${_stores.first['id']}');
        }
      } else if (_selectedStoreId == null) {
        final storeData = await ApiService.getStoreOrders(token);
        _selectedStoreId = int.tryParse('${storeData['stats']?['store_id']}');
      }
      if (_selectedStoreId != null && _selectedStoreId! > 0) {
        await _loadProductsAndCampaigns(token, _selectedStoreId!);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not load campaigns. Tap refresh to retry.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadProductsAndCampaigns(String token, int storeId) async {
    final products = await ApiService.getProductsForAdmin(token);
    _products = products
        .where((p) => int.tryParse('${p['store_id']}') == storeId)
        .toList();
    final data = await ApiService.getStoreOfferCampaigns(
      token,
      storeId: storeId,
    );
    _campaigns = (data['campaigns'] as List<dynamic>? ?? []);
    if (mounted) setState(() {});
  }

  Future<void> _onStoreChanged(int storeId) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    setState(() {
      _selectedStoreId = storeId;
      _loading = true;
    });
    try {
      await _loadProductsAndCampaigns(token, storeId);
      _resetForm();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDateTime(bool isStart) async {
    final base = isStart ? _startAt : _endAt;
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2100),
      initialDate: base,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
    );
    if (time == null || !mounted) return;
    final dt = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    setState(() {
      if (isStart) {
        _startAt = dt;
      } else {
        _endAt = dt;
      }
    });
  }

  Map<String, dynamic> _buildPayload() {
    return {
      'store_id': _selectedStoreId,
      'name': _nameCtrl.text.trim(),
      'description': _descCtrl.text.trim(),
      'campaign_type': _campaignType,
      'apply_scope': _scope,
      'is_enabled': _enabled,
      'start_at': _startAt.toIso8601String(),
      'end_at': _endAt.toIso8601String(),
      'discount_type': _campaignType == 'discount' ? _discountType : null,
      'discount_value': _campaignType == 'discount'
          ? double.tryParse(_discountValueCtrl.text.trim())
          : null,
      'buy_qty': _campaignType == 'bxgy'
          ? int.tryParse(_buyQtyCtrl.text.trim())
          : null,
      'get_qty': _campaignType == 'bxgy'
          ? int.tryParse(_getQtyCtrl.text.trim())
          : null,
      'product_ids': _scope == 'selected_products'
          ? _selectedProductIds.toList()
          : <int>[],
    };
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedStoreId == null || _selectedStoreId! <= 0) return;
    if (_endAt.isBefore(_startAt) || _endAt.isAtSameMomentAs(_startAt)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('End time must be after start time')),
      );
      return;
    }
    if (_scope == 'selected_products' && _selectedProductIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one product')),
      );
      return;
    }
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    setState(() => _saving = true);
    try {
      final payload = _buildPayload();
      if (_editingCampaignId != null && _editingCampaignId! > 0) {
        await ApiService.updateStoreOfferCampaign(
          token,
          campaignId: _editingCampaignId!,
          payload: payload,
        );
      } else {
        await ApiService.createStoreOfferCampaign(token, payload: payload);
      }
      await _loadProductsAndCampaigns(token, _selectedStoreId!);
      _resetForm();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Campaign saved successfully')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not save the campaign. Please try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteCampaign(int campaignId) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null || _selectedStoreId == null) return;
    setState(() => _saving = true);
    try {
      await ApiService.deleteStoreOfferCampaign(token, campaignId: campaignId);
      await _loadProductsAndCampaigns(token, _selectedStoreId!);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Campaign deleted')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not delete the campaign. Please try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _editCampaign(Map<String, dynamic> c) {
    setState(() {
      _editingCampaignId = int.tryParse('${c['id']}');
      _nameCtrl.text = (c['name'] ?? '').toString();
      _descCtrl.text = (c['description'] ?? '').toString();
      _campaignType = (c['campaign_type'] ?? 'discount').toString();
      _scope = (c['apply_scope'] ?? 'all_products').toString();
      _enabled = c['is_enabled'] == true || c['is_enabled'] == 1;
      _discountType = (c['discount_type'] ?? 'percent').toString();
      _discountValueCtrl.text = (c['discount_value'] ?? '').toString();
      _buyQtyCtrl.text = (c['buy_qty'] ?? 1).toString();
      _getQtyCtrl.text = (c['get_qty'] ?? 1).toString();
      _startAt =
          DateTime.tryParse('${c['start_at']}')?.toLocal() ?? DateTime.now();
      _endAt =
          DateTime.tryParse('${c['end_at']}')?.toLocal() ??
          DateTime.now().add(const Duration(hours: 1));
      _selectedProductIds
        ..clear()
        ..addAll(
          (c['product_ids'] as List<dynamic>? ?? [])
              .map((e) => int.tryParse('$e'))
              .whereType<int>(),
        );
    });
  }

  void _resetForm() {
    setState(() {
      _editingCampaignId = null;
      _nameCtrl.clear();
      _descCtrl.clear();
      _campaignType = 'discount';
      _discountType = 'percent';
      _discountValueCtrl.clear();
      _buyQtyCtrl.text = '1';
      _getQtyCtrl.text = '1';
      _scope = 'all_products';
      _enabled = true;
      _startAt = DateTime.now();
      _endAt = DateTime.now().add(const Duration(hours: 1));
      _selectedProductIds.clear();
    });
  }

  // ---------------------------------------------------------------------------
  // UI (phase B redesign): existing campaigns first, the create/edit form
  // below. Payload, validation and API calls are the methods above.
  // ---------------------------------------------------------------------------

  final GlobalKey _formCardKey = GlobalKey();

  void _startEdit(Map<String, dynamic> c) {
    _editCampaign(c);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _formCardKey.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(
          ctx,
          duration: AppMotion.medium,
          curve: AppMotion.curve,
        );
      }
    });
  }

  Future<void> _confirmDelete(Map<String, dynamic> c) async {
    final cid = int.tryParse('${c['id']}') ?? 0;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete campaign?'),
        content: Text(
          '"${(c['name'] ?? 'This campaign').toString()}" will stop applying to orders.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok == true) await _deleteCampaign(cid);
  }

  String _typeLabel(Map<String, dynamic> c) {
    final badge = (c['offer_badge'] ?? '').toString().trim();
    if (badge.isNotEmpty) return badge;
    final type = (c['campaign_type'] ?? '').toString();
    if (type == 'bxgy') {
      return 'Buy ${c['buy_qty'] ?? 1} get ${c['get_qty'] ?? 1}';
    }
    final value = Fmt.toDouble(c['discount_value']);
    if (value > 0) {
      return (c['discount_type'] ?? 'percent') == 'amount'
          ? '${Fmt.money(value)} off'
          : '${Fmt.number(value)}% off';
    }
    return 'Discount';
  }

  Widget _statusPill(Map<String, dynamic> c) {
    final enabled = c['is_enabled'] == true || c['is_enabled'] == 1;
    final start = Fmt.parseDate(c['start_at']);
    final end = Fmt.parseDate(c['end_at']);
    final now = DateTime.now();
    if (!enabled) return const TonePill.neutral('Off');
    if (end != null && end.isBefore(now)) {
      return const TonePill.neutral('Ended');
    }
    if (start != null && start.isAfter(now)) {
      return const TonePill.info('Scheduled');
    }
    return const TonePill.success('Live');
  }

  String _scopeLabel(Map<String, dynamic> c) {
    final scope = (c['apply_scope'] ?? 'all_products').toString();
    if (scope == 'selected_products') {
      final n = (c['product_ids'] as List<dynamic>? ?? []).length;
      return n > 0 ? 'Selected products ($n)' : 'Selected products';
    }
    return 'All products';
  }

  @override
  Widget build(BuildContext context) {
    final editing = _editingCampaignId != null;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Offer campaigns'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loading
                ? null
                : () {
                    if (_selectedStoreId != null) {
                      _onStoreChanged(_selectedStoreId!);
                    }
                  },
          ),
        ],
      ),
      body: _loading
          ? const SkeletonList(count: 3)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                if (widget.isAdmin) ...[
                  DropdownButtonFormField<int>(
                    initialValue: _selectedStoreId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Store',
                      prefixIcon: Icon(Icons.storefront_outlined),
                    ),
                    items: _stores
                        .map(
                          (s) => DropdownMenuItem<int>(
                            value: int.tryParse('${s['id']}'),
                            child: Text(
                              '${s['name']} (#${s['id']})',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) {
                      if (v != null) _onStoreChanged(v);
                    },
                  ),
                  const SizedBox(height: AppSpace.lg),
                ],
                SectionHeader(
                  title: 'Campaigns',
                  subtitle: _campaigns.isEmpty
                      ? null
                      : Fmt.count(_campaigns.length, 'campaign'),
                  padding: EdgeInsets.zero,
                ),
                const SizedBox(height: AppSpace.sm),
                if (_campaigns.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      icon: Icons.campaign_outlined,
                      title: 'No campaigns yet',
                      message:
                          'Create a discount or a buy-X-get-Y offer below. Live offers show on your store page.',
                      compact: true,
                    ),
                  )
                else
                  for (final raw in _campaigns) ...[
                    _buildCampaignCard((raw as Map).cast<String, dynamic>()),
                    const SizedBox(height: AppSpace.sm),
                  ],
                const SizedBox(height: AppSpace.lg),
                KeyedSubtree(key: _formCardKey, child: _buildForm(editing)),
              ],
            ),
    );
  }

  Widget _buildCampaignCard(Map<String, dynamic> c) {
    final description = (c['description'] ?? '').toString().trim();
    final isEditingThis =
        _editingCampaignId != null &&
        _editingCampaignId == int.tryParse('${c['id']}');
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      borderColor: isEditingThis ? AppColors.primary : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      (c['name'] ?? 'Campaign').toString(),
                      style: AppText.bodyStrong.copyWith(fontSize: 15),
                    ),
                    _statusPill(c),
                  ],
                ),
                const SizedBox(height: AppSpace.xs),
                TonePill.success(
                  _typeLabel(c),
                  icon: Icons.local_offer_outlined,
                ),
                if (description.isNotEmpty) ...[
                  const SizedBox(height: AppSpace.xs),
                  Text(
                    description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small,
                  ),
                ],
                const SizedBox(height: AppSpace.xs),
                Text(
                  '${Fmt.dateTime(c['start_at'], fallback: '-')} – ${Fmt.dateTime(c['end_at'], fallback: '-')}',
                  style: AppText.caption,
                ),
                Text(_scopeLabel(c), style: AppText.caption),
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                tooltip: 'Edit campaign',
                icon: const Icon(Icons.edit_outlined),
                onPressed: () => _startEdit(c),
              ),
              IconButton(
                tooltip: 'Delete campaign',
                icon: const Icon(Icons.delete_outline_rounded),
                color: AppColors.danger,
                onPressed: _saving ? null : () => _confirmDelete(c),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dateTile(String label, DateTime value, VoidCallback onTap) {
    return Material(
      color: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: AppRadius.controlAll,
        side: BorderSide(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              const Icon(
                Icons.schedule_rounded,
                size: 20,
                color: AppColors.primaryPressed,
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppText.caption),
                    Text(
                      Fmt.dateTime(value),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm(bool editing) {
    return AppCard(
      borderColor: editing ? AppColors.primary : null,
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    editing ? 'Edit campaign' : 'New campaign',
                    style: AppText.h2,
                  ),
                ),
                if (editing)
                  TextButton(
                    onPressed: _saving ? null : _resetForm,
                    child: const Text('Cancel edit'),
                  ),
              ],
            ),
            const SizedBox(height: AppSpace.md),
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(labelText: 'Campaign name'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: AppSpace.md),
            TextFormField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: AppSpace.lg),
            Text('Offer type', style: AppText.label),
            const SizedBox(height: AppSpace.sm),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(value: 'discount', label: Text('Discount')),
                ButtonSegment(value: 'bxgy', label: Text('Buy X get Y')),
              ],
              selected: {_campaignType},
              onSelectionChanged: (v) =>
                  setState(() => _campaignType = v.first),
            ),
            const SizedBox(height: AppSpace.md),
            if (_campaignType == 'discount')
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: 'percent', label: Text('%')),
                      ButtonSegment(value: 'amount', label: Text('Rs')),
                    ],
                    selected: {_discountType},
                    onSelectionChanged: (v) =>
                        setState(() => _discountType = v.first),
                  ),
                  const SizedBox(width: AppSpace.md),
                  Expanded(
                    child: TextFormField(
                      controller: _discountValueCtrl,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: _discountType == 'percent'
                            ? 'Discount %'
                            : 'Discount amount',
                        prefixText: _discountType == 'amount' ? 'Rs ' : null,
                        suffixText: _discountType == 'percent' ? '%' : null,
                      ),
                      validator: (v) {
                        if (_campaignType != 'discount') return null;
                        final n = double.tryParse((v ?? '').trim());
                        if (n == null || n <= 0) return 'Must be > 0';
                        return null;
                      },
                    ),
                  ),
                ],
              )
            else
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _buyQtyCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Buy qty'),
                      validator: (v) {
                        if (_campaignType != 'bxgy') return null;
                        final n = int.tryParse((v ?? '').trim());
                        if (n == null || n <= 0) return 'Must be > 0';
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: AppSpace.md),
                  Expanded(
                    child: TextFormField(
                      controller: _getQtyCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Get qty (free)',
                      ),
                      validator: (v) {
                        if (_campaignType != 'bxgy') return null;
                        final n = int.tryParse((v ?? '').trim());
                        if (n == null || n <= 0) return 'Must be > 0';
                        return null;
                      },
                    ),
                  ),
                ],
              ),
            const SizedBox(height: AppSpace.lg),
            Text('When', style: AppText.label),
            const SizedBox(height: AppSpace.sm),
            _dateTile('Starts', _startAt, () => _pickDateTime(true)),
            const SizedBox(height: AppSpace.sm),
            _dateTile('Ends', _endAt, () => _pickDateTime(false)),
            const SizedBox(height: AppSpace.lg),
            Text('Applies to', style: AppText.label),
            const SizedBox(height: AppSpace.sm),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                  value: 'all_products',
                  label: Text('All products'),
                ),
                ButtonSegment(
                  value: 'selected_products',
                  label: Text('Selected'),
                ),
              ],
              selected: {_scope},
              onSelectionChanged: (v) => setState(() => _scope = v.first),
            ),
            if (_scope == 'selected_products') ...[
              const SizedBox(height: AppSpace.sm),
              Text(
                '${_selectedProductIds.length} of ${_products.length} selected',
                style: AppText.caption,
              ),
              const SizedBox(height: AppSpace.xs),
              Container(
                height: 220,
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.border),
                  borderRadius: AppRadius.controlAll,
                ),
                child: _products.isEmpty
                    ? Center(
                        child: Text(
                          'No products for this store',
                          style: AppText.bodySecondary,
                        ),
                      )
                    : ListView.builder(
                        itemCount: _products.length,
                        itemBuilder: (context, index) {
                          final p = _products[index];
                          final pid = int.tryParse('${p['id']}');
                          if (pid == null) return const SizedBox.shrink();
                          final selected = _selectedProductIds.contains(pid);
                          final price = Fmt.toDouble(p['price']);
                          return CheckboxListTile(
                            dense: true,
                            value: selected,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: Text(
                              '${p['name']}',
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: price > 0
                                ? Text(Fmt.money(price), style: AppText.caption)
                                : null,
                            onChanged: (v) {
                              setState(() {
                                if (v == true) {
                                  _selectedProductIds.add(pid);
                                } else {
                                  _selectedProductIds.remove(pid);
                                }
                              });
                            },
                          );
                        },
                      ),
              ),
            ],
            const SizedBox(height: AppSpace.sm),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _enabled,
              title: Text('Campaign on', style: AppText.bodyStrong),
              subtitle: Text(
                'Turn off to pause without deleting',
                style: AppText.caption,
              ),
              onChanged: (v) => setState(() => _enabled = v),
            ),
            const SizedBox(height: AppSpace.md),
            PrimaryButton(
              label: editing ? 'Update campaign' : 'Create campaign',
              icon: Icons.check_rounded,
              loading: _saving,
              onPressed: _save,
            ),
            if (!editing) ...[
              const SizedBox(height: AppSpace.xs),
              TextButton(
                onPressed: _saving ? null : _resetForm,
                child: const Text('Reset form'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
