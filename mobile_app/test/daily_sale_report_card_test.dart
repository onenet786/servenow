import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servenow/widgets/admin/daily_sale_report_card.dart';

Map<String, dynamic> report({
  num adjustments = 0,
  num total = 14999,
  int noCost = 0,
}) => {
  'cash_sale': 8319,
  'credit_sale': 3930,
  'delivery_charges': 2750,
  'adjustments': adjustments,
  'total_sale': total,
  'cash_profit': 555.4,
  'credit_profit': 278.75,
  'total_profit': 834.15,
  'lines_without_cost': noCost,
};

Future<void> show(
  WidgetTester tester,
  Map<String, dynamic> data,
  dynamic todaysSale,
) => tester.pumpWidget(
  MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: DailySaleReportCard(report: data, todaysSale: todaysSale),
      ),
    ),
  ),
);

void main() {
  testWidgets('shows every figure exactly and confirms the day\'s sale', (
    tester,
  ) async {
    await show(tester, report(), 14999);

    expect(find.text('Rs 8,319'), findsOneWidget);
    expect(find.text('Rs 3,930'), findsOneWidget);
    expect(find.text('Rs 2,750'), findsOneWidget);
    expect(find.text('Rs 14,999'), findsOneWidget);
    expect(find.text('Rs 555.40'), findsOneWidget);
    expect(find.text('Rs 278.75'), findsOneWidget);
    expect(find.text('Rs 834.15'), findsOneWidget);
    expect(find.text('Matches the day\'s sale of Rs 14,999'), findsOneWidget);
    expect(find.text('Other adjustments'), findsNothing);
    expect(find.textContaining('no cost price'), findsNothing);
  });

  testWidgets('accepts amounts sent as text', (tester) async {
    await show(tester, {
      ...report(),
      'cash_sale': '8319.00',
      'total_sale': '14999.00',
    }, '14999.00');

    expect(find.textContaining('Matches the day'), findsOneWidget);
  });

  testWidgets('an adjustment is shown and counted in the match', (
    tester,
  ) async {
    await show(tester, report(adjustments: 660, total: 15659), 15659);

    expect(find.text('Other adjustments'), findsOneWidget);
    expect(find.text('Rs 660'), findsOneWidget);
    expect(find.textContaining('Matches the day'), findsOneWidget);
  });

  testWidgets('warns when the report differs from the day\'s sale', (
    tester,
  ) async {
    await show(tester, report(), 15000);

    expect(find.textContaining('Matches the day'), findsNothing);
    expect(find.textContaining('Differs from'), findsOneWidget);
  });

  testWidgets('warns when the rows do not add up to the total', (tester) async {
    await show(tester, report(total: 15000), 15000);

    expect(find.textContaining('Matches the day'), findsNothing);
    expect(find.textContaining('Differs from'), findsOneWidget);
  });

  testWidgets('says when sold items have no cost price', (tester) async {
    await show(tester, report(noCost: 2), 14999);

    expect(find.textContaining('2 sold items have no cost'), findsOneWidget);
  });
}
