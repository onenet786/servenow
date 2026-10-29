import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/staff/staff_ui.dart';

class ManageProductsScreen extends StatefulWidget {
  const ManageProductsScreen({super.key});

  @override
  State<ManageProductsScreen> createState() => _ManageProductsScreenState();
}

class _ManageProductsScreenState extends State<ManageProductsScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  List<dynamic> _products = [];
  List<dynamic> _filteredProducts = [];
  final TextEditingController _searchController = TextEditingController();
  String _selectedStoreFilter = 'all';
  bool _storeWiseView = true;
  bool _onlyVariantProducts = false;

  @override
  void initState() {
    super.initState();
    _loadProducts();
    _searchController.addListener(_filterProducts);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final auth = Provider.of<AuthProvider>(context, listen: false);
      List<dynamic> products = [];
      if (auth.isStoreOwner && auth.user != null) {
        products = await ApiService.getProductsForOwner(token, auth.user!.id);
      } else {
        products = await ApiService.getProductsForAdmin(token);
      }

      setState(() {
        _products = products;
        _isLoading = false;
      });
      _filterProducts();
    } catch (e) {
      _logger.e('Error loading products: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not load products. Pull to retry.'),
          ),
        );
      }
    }
  }

  void _filterProducts() {
    final query = _searchController.text.toLowerCase();
    final List<dynamic> filtered = _products.where((product) {
      final name = (product['name'] ?? product['product_name'] ?? '')
          .toString()
          .toLowerCase();
      final description = (product['description'] ?? '')
          .toString()
          .toLowerCase();
      final store = (product['store_name'] ?? '').toString().toLowerCase();
      final variants = (product['size_variants'] as List<dynamic>? ?? []);
      final hasVariants = variants.isNotEmpty;
      final variantsText = variants
          .map(
            (v) => (v['size_label'] ?? v['unit_name'] ?? 'variant').toString(),
          )
          .join(' ')
          .toLowerCase();

      final queryMatch =
          name.contains(query) ||
          description.contains(query) ||
          store.contains(query) ||
          variantsText.contains(query);

      final selectedStore = _selectedStoreFilter.toLowerCase();
      final storeMatch = selectedStore == 'all' || store == selectedStore;
      final variantMatch = !_onlyVariantProducts || hasVariants;

      return queryMatch && storeMatch && variantMatch;
    }).toList();

    setState(() => _filteredProducts = filtered);
  }

  List<String> _storeFilterOptions() {
    final stores =
        _products
            .map((p) => (p['store_name'] ?? 'Unknown Store').toString())
            .toSet()
            .toList()
          ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return stores;
  }

  // ---------------------------------------------------------------------------
  // UI (phase B redesign). Loading, filtering and saving are above / in
  // `_savePrices`, unchanged.
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final isStoreOwner = auth.isStoreOwner;
    // A store owner only has their own store: show the flat list, no
    // collapsed store header to expand first.
    final storeWise = _storeWiseView && !isStoreOwner;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(isStoreOwner ? 'My products' : 'Manage products'),
      ),
      body: _isLoading
          ? const SkeletonList(count: 5, imageHeight: 0)
          : RefreshIndicator(
              onRefresh: _loadProducts,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(child: _buildFilters(isStoreOwner)),
                  if (_filteredProducts.isEmpty)
                    SliverToBoxAdapter(
                      child: EmptyState(
                        icon: Icons.inventory_2_outlined,
                        title: _products.isEmpty
                            ? 'No products yet'
                            : 'No products match',
                        message: _products.isEmpty
                            ? 'Products added for your store will be listed here.'
                            : 'Try another search or clear the filters.',
                        actionLabel: _products.isEmpty
                            ? 'Refresh'
                            : 'Clear filters',
                        onAction: _products.isEmpty
                            ? _loadProducts
                            : () {
                                _searchController.clear();
                                setState(() {
                                  _onlyVariantProducts = false;
                                  _selectedStoreFilter = 'all';
                                });
                                _filterProducts();
                              },
                      ),
                    )
                  else if (storeWise)
                    _buildStoreWiseList()
                  else
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      sliver: SliverList.separated(
                        itemCount: _filteredProducts.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: AppSpace.sm),
                        itemBuilder: (context, index) => _buildProductCard(
                          _filteredProducts[index],
                          showStore: !isStoreOwner,
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilters(bool isStoreOwner) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _searchController,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: isStoreOwner
                  ? 'Search products or sizes'
                  : 'Search product, store or size',
              prefixIcon: const Icon(Icons.search_rounded),
            ),
          ),
          if (!isStoreOwner) ...[
            const SizedBox(height: AppSpace.sm),
            DropdownButtonFormField<String>(
              initialValue: _selectedStoreFilter,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Store',
                prefixIcon: Icon(Icons.storefront_outlined),
              ),
              items: [
                const DropdownMenuItem(value: 'all', child: Text('All stores')),
                ..._storeFilterOptions().map(
                  (store) => DropdownMenuItem(
                    value: store.toLowerCase(),
                    child: Text(store, overflow: TextOverflow.ellipsis),
                  ),
                ),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() => _selectedStoreFilter = value);
                _filterProducts();
              },
            ),
          ],
          const SizedBox(height: AppSpace.sm),
          Wrap(
            spacing: AppSpace.sm,
            runSpacing: AppSpace.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (!isStoreOwner) ...[
                ChoiceChip(
                  label: const Text('By store'),
                  selected: _storeWiseView,
                  onSelected: (v) {
                    if (!v) return;
                    setState(() => _storeWiseView = true);
                  },
                ),
                ChoiceChip(
                  label: const Text('List'),
                  selected: !_storeWiseView,
                  onSelected: (v) {
                    if (!v) return;
                    setState(() => _storeWiseView = false);
                  },
                ),
              ],
              // Visible on/off state: filter icon when off, check mark,
              // green fill and border when on.
              FilterChip(
                label: const Text('Has sizes'),
                selected: _onlyVariantProducts,
                showCheckmark: true,
                avatar: _onlyVariantProducts
                    ? null
                    : const Icon(Icons.filter_list_rounded, size: 18),
                selectedColor: AppColors.tint100,
                checkmarkColor: AppColors.primaryPressed,
                side: BorderSide(
                  color: _onlyVariantProducts
                      ? AppColors.primary
                      : AppColors.borderStrong,
                ),
                onSelected: (v) {
                  setState(() => _onlyVariantProducts = v);
                  _filterProducts();
                },
              ),
              Text(
                Fmt.count(_filteredProducts.length, 'product'),
                style: AppText.caption,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStoreWiseList() {
    final grouped = <String, List<dynamic>>{};
    for (final p in _filteredProducts) {
      final store = (p['store_name'] ?? 'Unknown Store').toString();
      grouped.putIfAbsent(store, () => []).add(p);
    }
    final stores = grouped.keys.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    final single = stores.length == 1;

    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      sliver: SliverList.separated(
        itemCount: stores.length,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpace.sm),
        itemBuilder: (context, index) {
          final store = stores[index];
          final items = grouped[store] ?? [];
          return AppCard(
            padding: EdgeInsets.zero,
            child: Theme(
              data: Theme.of(
                context,
              ).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                initiallyExpanded: single,
                shape: const RoundedRectangleBorder(),
                tilePadding: const EdgeInsets.symmetric(horizontal: 16),
                childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                leading: const Icon(
                  Icons.storefront_outlined,
                  color: AppColors.primaryPressed,
                ),
                title: Text(store, style: AppText.title),
                subtitle: Text(
                  Fmt.count(items.length, 'product'),
                  style: AppText.caption,
                ),
                children: [
                  for (final p in items) ...[
                    _buildProductCard(p, showStore: false, flat: true),
                    const SizedBox(height: AppSpace.sm),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildProductCard(
    dynamic product, {
    bool showStore = true,
    bool flat = false,
  }) {
    final variants = (product['size_variants'] as List<dynamic>? ?? []);
    final name = (product['name'] ?? product['product_name'] ?? 'Unknown')
        .toString();
    final storeName = (product['store_name'] ?? '').toString();
    final category = (product['category_name'] ?? '').toString();
    final stock = Fmt.toDouble(product['stock_quantity']).round();

    double? minVariant;
    for (final v in variants) {
      final p = Fmt.toDouble(v['price']);
      if (minVariant == null || p < minVariant) minVariant = p;
    }

    final meta = [
      if (showStore && storeName.isNotEmpty) storeName,
      if (category.isNotEmpty) category,
      'Stock ${Fmt.number(stock)}',
    ].join(' · ');

    final Widget priceLine;
    if (variants.isEmpty) {
      priceLine = PriceText(product['price']);
    } else if (variants.length == 1) {
      priceLine = Text(
        [
          Fmt.money(minVariant ?? 0),
          Fmt.unit(
            (variants.first['size_label'] ??
                    variants.first['unit_name'] ??
                    '')
                .toString(),
          ),
        ].where((t) => t.isNotEmpty).join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppText.price.copyWith(fontSize: 14),
      );
    } else {
      priceLine = Text(
        'from ${Fmt.money(minVariant ?? 0)} · ${Fmt.count(variants.length, 'size')}',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: AppText.price.copyWith(fontSize: 14),
      );
    }

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppNetworkImage(
              url: (product['image_url'] ?? '').toString().isEmpty
                  ? null
                  : ApiService.getImageUrl(product['image_url'].toString()),
              width: 56,
              height: 56,
              borderRadius: AppRadius.smallAll,
              placeholderIcon: Icons.fastfood_outlined,
            ),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.bodyStrong.copyWith(fontSize: 15),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption.copyWith(
                      color: stock <= 0 ? AppColors.danger : AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: AppSpace.xs),
                  // Price and its edit action share one row.
                  Row(
                    children: [
                      Expanded(child: priceLine),
                      const SizedBox(width: AppSpace.sm),
                      OutlinedButton.icon(
                        onPressed: () => _openEditPriceSheet(product),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 40),
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                        ),
                        icon: const Icon(Icons.edit_outlined, size: 18),
                        label: const Text('Edit price'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        if (variants.length > 1) ...[
          const SizedBox(height: AppSpace.sm),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: variants.map<Widget>((v) {
              final label = Fmt.unit(
                (v['size_label'] ?? v['unit_name'] ?? 'Size').toString(),
              );
              return Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: const BoxDecoration(
                  color: AppColors.surface3,
                  borderRadius: AppRadius.pillAll,
                ),
                child: Text(
                  '${label.isEmpty ? 'Size' : label} · ${Fmt.money(v['price'])}',
                  style: AppText.label.copyWith(fontFeatures: AppText.tabular),
                ),
              );
            }).toList(),
          ),
        ],
      ],
    );

    if (flat) {
      return Container(
        padding: const EdgeInsets.all(AppSpace.md),
        decoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: AppRadius.controlAll,
          border: Border.all(color: AppColors.border),
        ),
        child: content,
      );
    }
    return AppCard(padding: const EdgeInsets.all(AppSpace.md), child: content);
  }

  void _openEditPriceSheet(dynamic product) {
    final TextEditingController basePriceCtrl = TextEditingController(
      text: (product['price']?.toString() ?? ''),
    );
    final List<dynamic> variants =
        (product['size_variants'] as List<dynamic>? ?? []);
    final List<TextEditingController> variantCtrls = variants
        .map<TextEditingController>(
          (v) => TextEditingController(text: (v['price']?.toString() ?? '')),
        )
        .toList();
    final name = (product['name'] ?? product['product_name'] ?? '').toString();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        bool saving = false;
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            Future<void> save() async {
              setSheetState(() => saving = true);
              try {
                await _savePrices(
                  ctx,
                  product: product,
                  variants: variants,
                  basePriceCtrl: basePriceCtrl,
                  variantCtrls: variantCtrls,
                );
              } finally {
                if (ctx.mounted) setSheetState(() => saving = false);
              }
            }

            InputDecoration priceField(String label) =>
                InputDecoration(labelText: label, prefixText: 'Rs ');

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: StaffSheet(
                title: 'Update price',
                subtitle: name,
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  children: [
                    if (variants.isEmpty)
                      TextField(
                        controller: basePriceCtrl,
                        autofocus: true,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: priceField('Price'),
                      )
                    else ...[
                      Text('Prices per size', style: AppText.label),
                      const SizedBox(height: AppSpace.sm),
                      ...List.generate(variants.length, (i) {
                        final v = variants[i];
                        final label = Fmt.unit(
                          (v['size_label'] ?? v['unit_name'] ?? 'Size')
                              .toString(),
                        );
                        return Padding(
                          padding: const EdgeInsets.only(bottom: AppSpace.md),
                          child: TextField(
                            controller: variantCtrls[i],
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: priceField(
                              label.isEmpty ? 'Size ${i + 1}' : label,
                            ),
                          ),
                        );
                      }),
                    ],
                    const SizedBox(height: AppSpace.lg),
                    PrimaryButton(
                      label: 'Save price',
                      icon: Icons.check_rounded,
                      loading: saving,
                      onPressed: save,
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  /// Same validation and `updateProduct` calls as before.
  Future<void> _savePrices(
    BuildContext ctx, {
    required dynamic product,
    required List<dynamic> variants,
    required TextEditingController basePriceCtrl,
    required List<TextEditingController> variantCtrls,
  }) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      final int productId = int.parse(product['id'].toString());
      if (variants.isEmpty) {
        final price = double.tryParse(basePriceCtrl.text);
        if (price == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Please enter a valid price')),
          );
          return;
        }
        await ApiService.updateProduct(
          token,
          productId: productId,
          price: price,
        );
      } else {
        final List<Map<String, dynamic>> newVariants = [];
        for (int i = 0; i < variants.length; i++) {
          final v = variants[i];
          final p = double.tryParse(variantCtrls[i].text);
          if (p == null) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Please enter valid variant prices'),
              ),
            );
            return;
          }
          newVariants.add({
            'size_id': v['size_id'],
            'unit_id': v['unit_id'],
            'price': p,
          });
        }
        await ApiService.updateProduct(
          token,
          productId: productId,
          sizeVariants: newVariants,
        );
      }
      if (!mounted || !ctx.mounted) return;
      Navigator.of(ctx).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Price updated')));
      _loadProducts();
    } catch (e) {
      _logger.w('Price update failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not update the price. Please try again.'),
        ),
      );
    }
  }
}
