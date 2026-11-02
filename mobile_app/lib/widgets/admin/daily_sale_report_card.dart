import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_text.dart';
import '../../utils/formatters.dart';

/// One day's sale from `/api/admin/daily-sale-report`, checked against the
/// day's gross sale. Amounts are shown exactly, never rounded, so the rows can
/// be added up by hand.
class DailySaleReportCard extends StatelessWidget {
  const DailySaleReportCard({
    super.key,
    required this.report,
    required this.todaysSale,
  });

  final Map<String, dynamic> report;
  final dynamic todaysSale;

  double _value(String key) => Fmt.toDouble(report[key]);

  @override
  Widget build(BuildContext context) {
    final adjustments = _value('adjustments');
    final totalSale = _value('total_sale');
    final sale = Fmt.toDouble(todaysSale);
    final addsUp =
        (_value('cash_sale') +
                _value('credit_sale') +
                _value('delivery_charges') +
                adjustments -
                totalSale)
            .abs() <
        0.01;
    final matches = addsUp && (totalSale - sale).abs() < 0.01;
    final linesWithoutCost = Fmt.toDouble(report['lines_without_cost']).toInt();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text('Daily sale report', style: AppText.title),
          ),
          const SizedBox(height: 2),
          Text(
            'Cash and credit follow each store\'s payment term. Cancelled orders are not counted.',
            style: AppText.small,
          ),
          const SizedBox(height: AppSpace.sm),
          _row('Total cash sale', report['cash_sale']),
          _row('Total credit sale', report['credit_sale']),
          _row('Delivery charges', report['delivery_charges']),
          if (adjustments.abs() >= 0.01) _row('Other adjustments', adjustments),
          const Divider(color: AppColors.border, height: AppSpace.md),
          _row('Total sale', report['total_sale'], strong: true),
          const SizedBox(height: AppSpace.xs),
          _matchNote(matches, sale),
          const SizedBox(height: AppSpace.md),
          Text('Profit', style: AppText.bodyStrong),
          const SizedBox(height: AppSpace.xs),
          _row('Cash sale profit', report['cash_profit']),
          _row('Credit sale profit', report['credit_profit']),
          const Divider(color: AppColors.border, height: AppSpace.md),
          _row('Total profit', report['total_profit'], strong: true),
          if (linesWithoutCost > 0) ...[
            const SizedBox(height: AppSpace.sm),
            Text(
              linesWithoutCost == 1
                  ? '1 sold item has no cost price, so its full price is counted as profit.'
                  : '$linesWithoutCost sold items have no cost price, so their full price is counted as profit.',
              style: AppText.small.copyWith(color: AppColors.warning),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(String label, dynamic value, {bool strong = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: strong ? AppText.bodyStrong : AppText.bodySecondary,
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Text(
            Fmt.money(value),
            style: (strong ? AppText.price : AppText.bodyStrong).copyWith(
              color: strong ? AppColors.primary : AppColors.text,
              fontFeatures: AppText.tabular,
            ),
          ),
        ],
      ),
    );
  }

  Widget _matchNote(bool matches, double sale) {
    final color = matches ? AppColors.success : AppColors.warning;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          matches ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
          size: 16,
          color: color,
        ),
        const SizedBox(width: AppSpace.xs),
        Expanded(
          child: Text(
            matches
                ? 'Matches the day\'s sale of ${Fmt.money(sale)}'
                : 'Differs from the day\'s sale of ${Fmt.money(sale)}. Refresh, as a new order may have just come in.',
            style: AppText.small.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}
