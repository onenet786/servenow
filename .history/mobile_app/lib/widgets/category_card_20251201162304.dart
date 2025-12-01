import 'package:flutter/material.dart';

class CategoryCard extends StatelessWidget {
  final Map<String, dynamic> category;
  final bool isSelected;
  final VoidCallback onTap;

  const CategoryCard({
    super.key,
    required this.category,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 100,
        margin: const EdgeInsets.only(right: 16),
        decoration: BoxDecoration(
          color: isSelected ? Colors.green : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? Colors.green : Colors.grey[300]!,
            width: 2,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.grey.withValues(alpha: 0.2),
              spreadRadius: 1,
              blurRadius: 4,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              _getCategoryIcon(category['name']),
              size: 32,
              color: isSelected ? Colors.white : Colors.green,
            ),
            const SizedBox(height: 8),
            Text(
              category['name'],
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: isSelected ? Colors.white : Colors.black87,
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
            ),
          ],
        ),
      ),
    );
  }

  IconData _getCategoryIcon(String categoryName) {
    switch (categoryName.toLowerCase()) {
      case 'vegetables':
        return Icons.grass;
      case 'cooked food':
        return Icons.restaurant;
      case 'household':
        return Icons.home;
      case 'groceries':
        return Icons.shopping_basket;
      default:
        return Icons.category;
    }
  }
}
