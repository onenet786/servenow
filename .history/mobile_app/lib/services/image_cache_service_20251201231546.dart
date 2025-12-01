import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

class ImageCacheService {
  static Future<String?> getLocalImagePath(String imageUrl, String fileName) async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final localPath = path.join(directory.path, 'images', fileName);

      // Check if file exists
      final file = File(localPath);
      if (await file.exists()) {
        return localPath;
      }

      // Download and save
      final response = await http.get(Uri.parse(imageUrl));
      if (response.statusCode == 200) {
        // Ensure directory exists
        final imageDir = Directory(path.dirname(localPath));
        if (!await imageDir.exists()) {
          await imageDir.create(recursive: true);
        }

        await file.writeAsBytes(response.bodyBytes);
        return localPath;
      }
    } catch (e) {
      print('Error downloading image: $e');
    }
    return null;
  }

  static String getFileNameFromUrl(String url) {
    return path.basename(url);
  }
}
