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
            Image.asset(
              'assets/images/${_getCategoryImage(category['name'])}',
              width: 32,
              height: 32,
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

  String _getCategoryImage(String categoryName) {
    switch (categoryName.toLowerCase()) {
      case 'vegetables':
        return 'vegetables.jpg';
      case 'cooked food':
        return 'cooked-food.jpg';
      case 'household':
        return 'household.jpg'; // assuming we have this
      case 'groceries':
        return 'groceries.jpg'; // assuming
      case 'burgers':
        return 'burgers.jpg';
      case 'pizza':
        return 'pizza.jpg';
      case 'desserts':
        return 'desserts.jpg';
      default:
        return 'vegetables.jpg'; // default
    }
  }
}
