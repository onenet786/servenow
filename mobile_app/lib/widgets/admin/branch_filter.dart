import 'package:flutter/material.dart';

import '../../services/branch_service.dart';
import '../ui/ui.dart';

/// Head-office filter for staff lists. [names] is empty or has one entry for
/// a branch account, which is shown nothing because the server already limits
/// its lists to its own branch.
class BranchFilter extends StatelessWidget {
  final Map<int, String> names;
  final int? value;
  final ValueChanged<int?> onChanged;

  const BranchFilter({
    super.key,
    required this.names,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (names.length < 2) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpace.sm),
      child: DropdownButtonFormField<int?>(
        initialValue: value,
        decoration: const InputDecoration(
          labelText: 'Branch',
          prefixIcon: Icon(Icons.location_city_rounded),
        ),
        items: [
          const DropdownMenuItem<int?>(child: Text('All branches')),
          for (final entry in names.entries)
            DropdownMenuItem<int?>(value: entry.key, child: Text(entry.value)),
        ],
        onChanged: onChanged,
      ),
    );
  }
}

/// The branch a record belongs to. Hidden for branch accounts.
class BranchTag extends StatelessWidget {
  final Map<int, String> names;
  final dynamic branchId;

  /// Label for a record with no branch (staff at head office).
  final String? noBranchLabel;

  const BranchTag({
    super.key,
    required this.names,
    required this.branchId,
    this.noBranchLabel,
  });

  @override
  Widget build(BuildContext context) {
    if (names.length < 2) return const SizedBox.shrink();
    final hasBranch = int.tryParse('$branchId') != null;
    final label = hasBranch ? BranchService.nameOf(branchId) : noBranchLabel;
    if (label == null || label.isEmpty) return const SizedBox.shrink();
    return TonePill.neutral(label);
  }
}
