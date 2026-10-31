import 'package:flutter_test/flutter_test.dart';
import 'package:servenow/models/user.dart';
import 'package:servenow/services/branch_service.dart';

void main() {
  test('branch ids in API responses are read as numbers or text', () {
    final b = Branch.fromJson({
      'id': '2',
      'name': 'Muzaffargarh',
      'center_latitude': 30.0736,
      'center_longitude': null,
    });
    expect(b.id, 2);
    expect(b.latitude, 30.0736);
    expect(b.longitude, isNull);
  });

  test('a user keeps their branch; head office has none', () {
    Map<String, dynamic> json(dynamic branch) => {
      'id': 1,
      'user_type': 'customer',
      'branch_id': branch,
    };
    expect(User.fromJson(json(2)).branchId, 2);
    expect(User.fromJson(json('2')).branchId, 2);
    expect(User.fromJson(json(null)).branchId, isNull);
    expect(User.fromJson(json(2)).toJson()['branch_id'], 2);
  });

  test('the map falls back to Kot Addu when no branch is known', () {
    expect(BranchService.defaultCenter, BranchService.kotAdduCenter);
  });
}
