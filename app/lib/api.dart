import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;

/// 서버 주소. 안드로이드 에뮬레이터는 10.0.2.2가 맥의 localhost.
/// 실기기 등 다른 주소는 `--dart-define=API_URL=http://192.168.0.10:8080`.
final String apiBase = const String.fromEnvironment('API_URL').isNotEmpty
    ? const String.fromEnvironment('API_URL')
    : Platform.isAndroid
    ? 'http://10.0.2.2:8080'
    : 'http://localhost:8080';

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

class Api {
  Api(this.token);
  String? token;
  final _client = http.Client();

  Future<dynamic> call(String method, String path, [Object? body]) async {
    final req = http.Request(method, Uri.parse('$apiBase$path'))
      ..headers['content-type'] = 'application/json'
      ..headers.addAll(token == null ? {} : {'authorization': 'Bearer $token'});
    if (body != null) req.body = jsonEncode(body);
    late http.Response res;
    try {
      res = await http.Response.fromStream(
        await _client.send(req).timeout(const Duration(seconds: 40)),
      );
    } catch (_) {
      throw ApiException(0, '서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해주세요.');
    }
    final data = res.body.isEmpty
        ? null
        : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        (data is Map ? data['message'] : null) ?? '오류 ${res.statusCode}',
      );
    }
    return data;
  }

  Future<String> login(String email, String password) async => (await call(
    'POST',
    '/auth/login',
    {'email': email.trim(), 'password': password},
  ))['token'];
  Future<String> register(String name, String email, String password) async =>
      (await call('POST', '/auth/register', {
        'displayName': name.trim(),
        'email': email.trim(),
        'password': password,
      }))['token'];
  Future<Map<String, dynamic>> me() async => await call('GET', '/me');
  Future<Map<String, dynamic>> updateMe(Map<String, dynamic> body) async =>
      await call('PATCH', '/me', body);

  Future<List<dynamic>> plans(String date) async =>
      await call('GET', '/plans?from=$date&to=$date');
  Future<void> createPlan(Map<String, dynamic> p) => call('POST', '/plans', p);
  Future<void> updatePlan(String id, Map<String, dynamic> p) =>
      call('PATCH', '/plans/$id', p);
  Future<void> deletePlan(String id) => call('DELETE', '/plans/$id');

  Future<Map<String, dynamic>> openFocus(String planId) async =>
      await call('POST', '/plans/$planId/focus');
  Future<Map<String, dynamic>> focus(String id) async =>
      await call('GET', '/focus/$id');
  Future<Map<String, dynamic>> focusAction(String id, String action) async =>
      await call('POST', '/focus/$id/$action');
  Future<Map<String, dynamic>> claimReward(String planId) async =>
      await call('POST', '/plans/$planId/reward');

  Future<List<dynamic>> goals() async => await call('GET', '/goals');
  Future<void> createGoal(String title) =>
      call('POST', '/goals', {'title': title});
  Future<void> updateGoal(String id, Map<String, dynamic> g) =>
      call('PATCH', '/goals/$id', g);
  Future<void> deleteGoal(String id) => call('DELETE', '/goals/$id');
}

String ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
