import 'dart:convert';

class ImageCacheService {
  static String getFileNameFromUrl(String url) {
    try {
      final uri = Uri.parse(url);
      final lastSegment = uri.pathSegments.isNotEmpty
          ? uri.pathSegments.last
          : 'image';
      return lastSegment.isEmpty
          ? base64Url.encode(utf8.encode(url))
          : lastSegment;
    } catch (_) {
      return base64Url.encode(utf8.encode(url));
    }
  }

  static Future<String?> getLocalImagePath(String url, String fileName) async {
    return null;
  }
}
