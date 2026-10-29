import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/cart_provider.dart';
import '../utils/cart_counts.dart';
import '../utils/customer_language.dart';

enum CustomerTab { home, stores, cart, orders, account }

/// Navigation between the customer tabs.
///
/// Home, Stores and Account live inside the customer home (`/home`);
/// Cart (`/cart`) and Orders (`/orders`) are their own routes. Every screen
/// that shows [CustomerBottomNav] goes through [CustomerNav.go], so the tabs
/// behave the same everywhere and the highlight is never stale.
class CustomerNav {
  CustomerNav._();

  /// Tab the customer home should show. The home listens to this.
  static final ValueNotifier<CustomerTab> homeTab = ValueNotifier(
    CustomerTab.home,
  );

  static void go(BuildContext context, CustomerTab tab, {CustomerTab? from}) {
    final navigator = Navigator.of(context);
    switch (tab) {
      case CustomerTab.home:
      case CustomerTab.stores:
      case CustomerTab.account:
        homeTab.value = tab;
        var found = false;
        navigator.popUntil((route) {
          if (route.settings.name == '/home') {
            found = true;
            return true;
          }
          return route.isFirst;
        });
        if (!found) navigator.pushReplacementNamed('/home');
        return;
      case CustomerTab.cart:
      case CustomerTab.orders:
        final name = tab == CustomerTab.cart ? '/cart' : '/orders';
        final onOtherTabRoute =
            from == CustomerTab.cart || from == CustomerTab.orders;
        if (onOtherTabRoute) {
          navigator.pushReplacementNamed(name);
        } else {
          navigator.pushNamed(name);
        }
        return;
    }
  }
}

/// The customer bottom navigation: Home, Stores, Cart (with the cart badge),
/// Orders, Account. Every destination has a semantics label.
class CustomerBottomNav extends StatelessWidget {
  final CustomerTab current;
  final bool isUrdu;

  /// Overrides the default [CustomerNav.go] behaviour (used by the home,
  /// which switches its own tabs in place).
  final ValueChanged<CustomerTab>? onSelect;

  const CustomerBottomNav({
    super.key,
    required this.current,
    this.isUrdu = false,
    this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    String tr(String s) => CustomerLanguage.tr(isUrdu, s);
    final units = context.select<CartProvider, int>((c) => c.totalUnits);

    Widget cartIcon(bool selected) {
      final icon = Icon(
        selected ? Icons.shopping_cart_rounded : Icons.shopping_cart_outlined,
      );
      if (units <= 0) return icon;
      return Badge(
        label: Text(units > 99 ? '99+' : '$units'),
        child: icon,
      );
    }

    final destinations = <NavigationDestination>[
      NavigationDestination(
        icon: const Icon(Icons.home_outlined),
        selectedIcon: const Icon(Icons.home_rounded),
        label: tr('Home'),
        tooltip: tr('Home'),
      ),
      NavigationDestination(
        icon: const Icon(Icons.storefront_outlined),
        selectedIcon: const Icon(Icons.storefront_rounded),
        label: tr('Stores'),
        tooltip: tr('Stores'),
      ),
      NavigationDestination(
        icon: cartIcon(false),
        selectedIcon: cartIcon(true),
        label: tr('Cart'),
        tooltip: units > 0 ? '${tr('Cart')} ($units)' : tr('Cart'),
      ),
      NavigationDestination(
        icon: const Icon(Icons.receipt_long_outlined),
        selectedIcon: const Icon(Icons.receipt_long_rounded),
        label: tr('Orders'),
        tooltip: tr('Orders'),
      ),
      NavigationDestination(
        icon: const Icon(Icons.person_outline_rounded),
        selectedIcon: const Icon(Icons.person_rounded),
        label: tr('Account'),
        tooltip: tr('Account'),
      ),
    ];

    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0xFFE5E7EB))),
      ),
      child: NavigationBar(
        selectedIndex: current.index,
        destinations: destinations,
        onDestinationSelected: (index) {
          final tab = CustomerTab.values[index];
          if (onSelect != null) {
            onSelect!(tab);
            return;
          }
          if (tab == current) return;
          CustomerNav.go(context, tab, from: current);
        },
      ),
    );
  }
}
