class User {
  final int id;
  final String firstName;
  final String lastName;
  final String email;
  final String userType;
  final String? phone;
  final String? address;

  User({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.userType,
    this.phone,
    this.address,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      firstName: json['first_name'] ?? '',
      lastName: json['last_name'] ?? '',
      email: json['email'] ?? '',
      userType: json['user_type'] ?? 'customer',
      phone: json['phone'],
      address: json['address'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'first_name': firstName,
      'last_name': lastName,
      'email': email,
      'user_type': userType,
      'phone': phone,
      'address': address,
    };
  }
}
