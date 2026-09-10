import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CustomerLanguage {
  static const String preferenceKey = 'customer_dashboard_language';
  static const String preferenceInitializedKey =
      'customer_dashboard_language_initialized';

  static Future<bool> loadIsUrdu() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final hasSavedPreference =
          prefs.getBool(preferenceInitializedKey) ?? false;
      if (!hasSavedPreference) return false;
      return (prefs.getString(preferenceKey) ?? 'en') == 'ur';
    } catch (_) {
      return false;
    }
  }

  static Future<void> saveIsUrdu(bool isUrdu) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(preferenceKey, isUrdu ? 'ur' : 'en');
      await prefs.setBool(preferenceInitializedKey, true);
    } catch (_) {}
  }

  static TextDirection textDirection(bool isUrdu) {
    return isUrdu ? TextDirection.rtl : TextDirection.ltr;
  }

  static String tr(bool isUrdu, String english) {
    if (!isUrdu) return english;

    const translations = <String, String>{
      'Home': 'ہوم',
      'Stores': 'دکانیں',
      'Orders': 'آرڈرز',
      'Cart': 'کارٹ',
      'Products': 'مصنوعات',
      'Store': 'دکان',
      'Store Details': 'دکان کی تفصیل',
      'Store not found': 'دکان نہیں ملی',
      'Unknown Store': 'نامعلوم دکان',
      'Open': 'کھلا',
      'Closed': 'بند',
      'OPEN': 'کھلا',
      'CLOSED': 'بند',
      'Error': 'خرابی',
      'Retry': 'دوبارہ کوشش کریں',
      'All': 'سب',
      'Active': 'فعال',
      'History': 'ہسٹری',
      'Delivery': 'ڈیلیوری',
      'Address': 'پتہ',
      'Payment': 'ادائیگی',
      'Support': 'سپورٹ',
      'PKR': 'روپے',
      'Call': 'کال',
      'SMS': 'ایس ایم ایس',
      'WhatsApp': 'واٹس ایپ',
      'Customer': 'کسٹمر',
      'Status': 'حیثیت',
      'Total': 'کل',
      'Delivered': 'پہنچا دیا گیا',
      'Pending': 'زیر التوا',
      'Cancelled': 'منسوخ',
      'Completed': 'مکمل',
      'Items': 'اشیاء',
      'Qty': 'تعداد',
      'Item': 'آئٹم',
      'Order Date': 'آرڈر تاریخ',
      'Total Orders': 'کل آرڈرز',
      'Active Orders': 'فعال آرڈرز',
      'Completed Orders': 'مکمل آرڈرز',
      'My Orders': 'میرے آرڈرز',
      'Order update': 'آرڈر اپ ڈیٹ',
      'No orders found.': 'کوئی آرڈر نہیں ملا۔',
      'Could not launch dialer': 'ڈائلر نہیں کھل سکا',
      'Could not launch SMS app': 'ایس ایم ایس ایپ نہیں کھل سکی',
      'Could not launch WhatsApp': 'واٹس ایپ نہیں کھل سکا',
      'No valid phone number': 'کوئی درست فون نمبر موجود نہیں',
      'Dialer app not available': 'ڈائلر ایپ دستیاب نہیں',
      'SMS app not available': 'ایس ایم ایس ایپ دستیاب نہیں',

      'Your Cart': 'آپ کی کارٹ',
      'Your cart is empty': 'آپ کی کارٹ خالی ہے',
      'Clear Cart?': 'کارٹ خالی کریں؟',
      'Are you sure you want to remove all items?':
          'کیا آپ واقعی تمام اشیاء ہٹانا چاہتے ہیں؟',
      'No': 'نہیں',
      'Yes': 'جی ہاں',
      'Add to Cart': 'کارٹ میں شامل کریں',
      'Added to cart': 'کارٹ میں شامل کر دیا گیا',
      'Unavailable': 'دستیاب نہیں',
      'Out of stock': 'اسٹاک ختم',
      'Only': 'صرف',
      'available': 'دستیاب',
      'Select Variant / Size': 'سائز / قسم منتخب کریں',
      'Options': 'آپشنز',
      'Related Items': 'متعلقہ اشیاء',
      'View Details': 'تفصیل دیکھیں',
      'In Stock': 'اسٹاک دستیاب',
      'Price': 'قیمت',
      'Description': 'تفصیل',
      'Proceed to Checkout': 'چیک آؤٹ پر جائیں',
      'Checkout': 'چیک آؤٹ',
      'Delivery Details': 'ڈیلیوری تفصیلات',
      'Full Name': 'پورا نام',
      'Phone Number': 'فون نمبر',
      'Delivery Address': 'ڈیلیوری پتہ',
      'Special Instructions': 'خصوصی ہدایات',
      'Payment Method': 'ادائیگی کا طریقہ',
      'Preferred Delivery Time': 'پسندیدہ ڈیلیوری وقت',
      'Select delivery time': 'ڈیلیوری وقت منتخب کریں',
      'ASAP (30-45 mins)': 'جلد از جلد (30-45 منٹ)',
      'Within 1 hour': '1 گھنٹے کے اندر',
      'Within 2 hours': '2 گھنٹوں کے اندر',
      'Tomorrow': 'کل',
      'Order Summary': 'آرڈر خلاصہ',
      'Subtotal': 'ذیلی کل',
      'Delivery Fee': 'ڈیلیوری فیس',
      'Grand Total': 'مجموعی کل',
      'Cash on Delivery': 'ڈیلیوری پر نقد ادائیگی',
      'Pay with cash at delivery': 'ڈیلیوری پر نقد ادائیگی کریں',
      'Credit/Debit Card': 'کریڈٹ/ڈیبٹ کارڈ',
      'Pay securely with your card': 'اپنے کارڈ سے محفوظ ادائیگی کریں',
      'Wallet': 'والیٹ',
      'Use your in-app wallet': 'ایپ والا والیٹ استعمال کریں',
      'Place Order': 'آرڈر کریں',
      'Insufficient wallet balance. Need': 'والیٹ بیلنس ناکافی ہے۔ مزید درکار',
      'more.': 'مزید۔',
      'Failed to place order': 'آرڈر نہیں ہو سکا',
      'Failed to load orders': 'آرڈرز لوڈ نہیں ہو سکے',
      'Hide details': 'تفصیل چھپائیں',
      'View details': 'تفصیل دیکھیں',
      'No shipment details available': 'شپمنٹ کی کوئی تفصیل دستیاب نہیں۔',
      'No items found for this order': 'اس آرڈر کے لیے کوئی آئٹم نہیں ملی۔',
      'Call Store': 'دکان کو کال کریں',

      'Login': 'لاگ اِن',
      'LOGIN': 'لاگ اِن',
      'Welcome Back': 'دوبارہ خوش آمدید',
      'Sign in to continue': 'جاری رکھنے کے لیے سائن اِن کریں',
      'Email Address': 'ای میل ایڈریس',
      'Password': 'پاس ورڈ',
      'Please enter email': 'براہ کرم ای میل درج کریں',
      'Enter a valid email': 'درست ای میل درج کریں',
      'Please enter password': 'براہ کرم پاس ورڈ درج کریں',
      'Forgot Password?': 'پاس ورڈ بھول گئے؟',
      "Don't have an account? ": 'اکاؤنٹ نہیں ہے؟ ',
      'Register Here': 'یہاں رجسٹر کریں',

      'Register for ServeNow': 'سروناؤ کے لیے رجسٹر کریں',
      'Create your account': 'اپنا اکاؤنٹ بنائیں',
      'Register': 'رجسٹر کریں',
      'Already have an account? Login here':
          'پہلے سے اکاؤنٹ ہے؟ یہاں لاگ اِن کریں',
      'Full name is required': 'پورا نام ضروری ہے',
      'Full name is too short': 'پورا نام بہت مختصر ہے',
      'Email is required': 'ای میل ضروری ہے',
      'Password is required': 'پاس ورڈ ضروری ہے',
      'Password must be at least 6 characters':
          'پاس ورڈ کم از کم 6 حروف پر مشتمل ہو',
      'Date of Birth': 'تاریخ پیدائش',
      'Date of birth is required': 'تاریخ پیدائش ضروری ہے',
      'Phone number is required': 'فون نمبر ضروری ہے',
      'Use +923 followed by 9 digits': '+923 کے بعد 9 ہندسے درج کریں',
      'Address is required': 'پتہ ضروری ہے',
      'Address is too short': 'پتہ بہت مختصر ہے',

      'Verify Email': 'ای میل کی تصدیق کریں',
      'Please enter a 6-digit code': 'براہ کرم 6 ہندسوں کا کوڈ درج کریں',
      'Email verified! Please login.':
          'ای میل کی تصدیق ہو گئی! براہ کرم لاگ اِن کریں۔',
      'Verification code sent!': 'تصدیقی کوڈ بھیج دیا گیا!',
      'Confirm your email': 'اپنی ای میل کی تصدیق کریں',
      'Verify': 'تصدیق کریں',
      'Resend Code': 'کوڈ دوبارہ بھیجیں',

      'Forgot Password': 'پاس ورڈ بھول گئے',
      "Enter your email address and we'll send you a 6-digit code to reset your password.":
          'اپنا ای میل درج کریں، ہم پاس ورڈ ری سیٹ کے لیے 6 ہندسوں کا کوڈ بھیجیں گے۔',
      'example@mail.com': 'example@mail.com',
      'SEND CODE': 'کوڈ بھیجیں',
      'Back to Login': 'واپس لاگ اِن پر جائیں',
      'Reset OTP sent to your email':
          'ری سیٹ او ٹی پی آپ کی ای میل پر بھیج دیا گیا ہے',

      'Admin Dashboard': 'ایڈمن ڈیش بورڈ',
      'Dashboard': 'ڈیش بورڈ',
      'Manage Stores': 'دکانیں منظم کریں',
      'Store Balances': 'دکان بیلنس',
      'Store Status': 'دکان کی حیثیت',
      'Products & Variants': 'مصنوعات اور اقسام',
      'Manage Users': 'صارفین منظم کریں',
      'Riders': 'رائیڈرز',
      'Inventory Reports': 'انوینٹری رپورٹس',
      'Manage Orders': 'آرڈرز منظم کریں',
      'Change Password': 'پاس ورڈ تبدیل کریں',
      'Logout': 'لاگ آؤٹ',
      "Today's Orders": 'آج کے آرڈرز',
      'All Orders': 'تمام آرڈرز',
      "Today's Visitors": 'آج کے وزٹرز',
      'Recent Activity': 'حالیہ سرگرمی',
      'Inventory': 'انوینٹری',
      'Offers': 'آفرز',

      'Live Rider Tracker': 'لائیو رائیڈر ٹریکر',
      'Auto-refreshing rider positions for active deliveries':
          'فعال ڈیلیوریوں کے لیے رائیڈر کی پوزیشن خودکار طور پر تازہ ہو رہی ہے',
      'live': 'لائیو',
      'Select Rider': 'رائیڈر منتخب کریں',
      'All riders': 'تمام رائیڈرز',
      'Rider': 'رائیڈر',
      'Back to all riders': 'تمام رائیڈرز پر واپس',
      'Routes': 'روٹس',
      'Assigned Order': 'تعین شدہ آرڈر',
      'Trail Points': 'ٹریل پوائنٹس',
      'Distance': 'فاصلہ',
      'ETA': 'متوقع وقت',
      'No riders are currently sharing live locations':
          'اس وقت کوئی رائیڈر اپنی لائیو لوکیشن شیئر نہیں کر رہا',

      'Rider Dashboard': 'رائیڈر ڈیش بورڈ',
      'Financial History': 'مالی ہسٹری',
      'Profile': 'پروفائل',
      'Refresh': 'ریفریش',
      'Welcome Rider': 'خوش آمدید رائیڈر',
      'Assigned': 'تعینات',
      'Vehicle': 'گاڑی',
      'ID': 'شناخت',
      'Wallet Balance': 'والیٹ بیلنس',
      'Wallet Information': 'والیٹ کی معلومات',
      'Account Type': 'اکاؤنٹ کی قسم',
      'Rider Wallet': 'رائیڈر والیٹ',
      'Wallet updated': 'والیٹ اپ ڈیٹ ہو گئی',
      'Payment marked as received! Wallet updated.':
          'ادائیگی وصول شدہ مارک کر دی گئی! والیٹ اپ ڈیٹ ہو گئی۔',

      'Store Dashboard': 'اسٹور ڈیش بورڈ',
      'New Orders': 'نئے آرڈرز',
      'Store Financial History': 'اسٹور مالی ہسٹری',
      'Update Store Status': 'اسٹور کی حیثیت اپ ڈیٹ کریں',
      'Mark as Closed': 'بند مارک کریں',
      'Status Message': 'حیثیت کا پیغام',
      'Store is closed due to maintenance...':
          'اسٹور مینٹیننس کی وجہ سے بند ہے...',
      'Store message updated': 'اسٹور میسج اپ ڈیٹ ہو گیا',
      'Failed to save:': 'سیو نہیں ہو سکا:',
      'Save': 'سیو کریں',
      'Failed to open store message dialog:':
          'اسٹور میسج ڈائیلاگ کھل نہیں سکا:',
      'Select Start Date': 'شروع کی تاریخ منتخب کریں',
      'Select End Date': 'اختتام کی تاریخ منتخب کریں',
      'Failed to load orders:': 'آرڈرز لوڈ نہیں ہو سکے:',
      'Order marked as': 'آرڈر کو یوں مارک کر دیا گیا',
      'Failed to update status:': 'حیثیت اپ ڈیٹ نہیں ہو سکی:',
    };

    return translations[english] ?? english;
  }
}
