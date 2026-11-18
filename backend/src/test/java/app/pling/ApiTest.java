package app.pling;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.IntStream;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 실제 PostgreSQL(pling_test)에 붙는 통합 테스트. DB는 매번 초기화되므로 이름이 _test로 끝나야 한다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=${TEST_DATABASE_URL:jdbc:postgresql://localhost:5432/pling_test}",
    "pling.auth.dev-secret=test-secret-only-0123456789abcdef",
    "spring.flyway.clean-disabled=false"})
class ApiTest {
    @TestConfiguration
    static class CleanDb {
        @Bean
        FlywayMigrationStrategy cleanThenMigrate() {
            return (Flyway f) -> {
                var url = f.getConfiguration().getDataSource().toString();
                try (var c = f.getConfiguration().getDataSource().getConnection()) {
                    if (!c.getCatalog().endsWith("_test")) throw new IllegalStateException("테스트 DB 이름은 _test로 끝나야 합니다: " + url);
                } catch (java.sql.SQLException e) { throw new RuntimeException(e); }
                f.clean();
                f.migrate();
            };
        }
    }

    @LocalServerPort int port;
    @Autowired JsonMapper json;
    @Autowired JdbcClient db;
    final HttpClient http = HttpClient.newHttpClient();
    final Map<String, String> tokens = new HashMap<>();

    record Res(int status, JsonNode body) {}

    String token(String nick) {
        return tokens.computeIfAbsent(nick, n -> send(null, "POST", "/dev/token", Map.of("nickname", n)).join().body().get("token").asString());
    }

    CompletableFuture<Res> send(String nick, String method, String path, Object body) {
        var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("content-type", "application/json")
            .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (nick != null) b.header("authorization", "Bearer " + token(nick));
        return http.sendAsync(b.build(), HttpResponse.BodyHandlers.ofString())
            .thenApply(r -> new Res(r.statusCode(), r.body().isEmpty() ? null : json.readTree(r.body())));
    }

    Res api(String nick, String method, String path, Object body) { return send(nick, method, path, body).join(); }
    Res api(String nick, String method, String path) { return api(nick, method, path, null); }

    List<Res> parallel(int n, java.util.function.Supplier<CompletableFuture<Res>> f) {
        var fs = IntStream.range(0, n).mapToObj(i -> f.get()).toList();
        return fs.stream().map(CompletableFuture::join).toList();
    }

    static Map<String, Object> plan(Object... kv) {
        var m = new HashMap<String, Object>(Map.of("title", "영어 단어", "date", "2026-11-18", "start", "10:00", "end", "11:00", "color", "#FFB86B"));
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void 인증_없으면_401() {
        assertEquals(401, api(null, "GET", "/plans").status());
        var r = http.sendAsync(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/plans")).header("authorization", "Bearer nope").build(),
            HttpResponse.BodyHandlers.discarding()).join();
        assertEquals(401, r.statusCode());
        assertEquals(200, api(null, "GET", "/health").status());
        assertEquals(400, api(null, "POST", "/dev/token", Map.of("nickname", " ")).status());
    }

    @Test
    void 일정_CRUD_서울시간_UTC저장() {
        var c = api("alice", "POST", "/plans", plan());
        assertEquals(201, c.status());
        assertEquals("2026-11-18T01:00:00Z", c.body().get("startAt").asString());
        assertEquals("10:00", c.body().get("start").asString());
        assertEquals(1, c.body().get("version").asInt());
        var id = c.body().get("id").asString();

        assertEquals(1, api("alice", "GET", "/plans?from=2026-11-18&to=2026-11-18").body().size());
        assertEquals(0, api("alice", "GET", "/plans?from=2026-11-19&to=2026-11-19").body().size());
        assertEquals(400, api("alice", "GET", "/plans?from=2026-01-01&to=2026-12-31").status());

        var u = api("alice", "PATCH", "/plans/" + id, Map.of("title", "영어 복습", "start", "20:00", "end", "21:00", "version", 1));
        assertEquals(200, u.status());
        assertEquals("영어 복습", u.body().get("title").asString());
        assertEquals("20:00", u.body().get("start").asString());
        assertEquals(2, u.body().get("version").asInt());
        assertEquals(409, api("alice", "PATCH", "/plans/" + id, Map.of("title", "x", "version", 1)).status());

        assertEquals(204, api("alice", "DELETE", "/plans/" + id).status());
        assertEquals(404, api("alice", "DELETE", "/plans/" + id).status());
    }

    @Test
    void 입력_검증() {
        assertEquals(400, api("alice", "POST", "/plans", plan("title", "a".repeat(61))).status());
        assertEquals(400, api("alice", "POST", "/plans", plan("start", "11:00", "end", "10:00")).status());
        assertEquals(400, api("alice", "POST", "/plans", plan("color", "red")).status());
        assertEquals(400, api("alice", "POST", "/plans", plan("date", "2026-02-30")).status());
    }

    @Test
    void 겹침_거부_맞닿음_허용_같은색_허용() {
        assertEquals(201, api("alice", "POST", "/plans", plan("date", "2026-11-20", "start", "09:00", "end", "10:00")).status());
        assertEquals(409, api("alice", "POST", "/plans", plan("date", "2026-11-20", "start", "09:30", "end", "10:30")).status());
        assertEquals(201, api("alice", "POST", "/plans", plan("date", "2026-11-20", "start", "10:00", "end", "11:00")).status());
        assertEquals(201, api("bob", "POST", "/plans", plan("date", "2026-11-20", "start", "09:00", "end", "10:00")).status());
    }

    @Test
    void 동시_같은시간_10개_중_1개만() {
        token("carol");
        var rs = parallel(10, () -> send("carol", "POST", "/plans", plan("date", "2026-11-21")));
        assertEquals(1, rs.stream().filter(r -> r.status() == 201).count());
        assertEquals(9, rs.stream().filter(r -> r.status() == 409).count());
    }

    @Test
    void 다른_사용자_접근_불가() {
        var p = api("alice", "POST", "/plans", plan("date", "2026-11-22")).body().get("id").asString();
        var g = api("alice", "POST", "/goals", Map.of("title", "수학 1단원")).body().get("id").asString();
        assertEquals(404, api("bob", "PATCH", "/plans/" + p, Map.of("title", "hack")).status());
        assertEquals(404, api("bob", "DELETE", "/plans/" + p).status());
        assertEquals(404, api("bob", "POST", "/plans/" + p + "/focus").status());
        assertEquals(404, api("bob", "PATCH", "/goals/" + g, Map.of("done", true)).status());
        var s = api("alice", "POST", "/plans/" + p + "/focus").body().get("id").asString();
        assertEquals(404, api("bob", "GET", "/focus/" + s).status());
        assertEquals(404, api("bob", "POST", "/focus/" + s + "/complete").status());
        assertEquals(409, api("bob", "POST", "/plans/" + p + "/reward").status());
        assertEquals(404, api("bob", "PATCH", "/plans/not-a-uuid", Map.of("title", "x")).status());
    }

    @Test
    void 집중_수동시작_멈춤재개_완료_5코인_1회() {
        var p = api("dave", "POST", "/plans", plan("date", "2026-11-23", "start", "10:00", "end", "10:25")).body().get("id").asString();
        var s = api("dave", "POST", "/plans/" + p + "/focus").body();
        var sid = s.get("id").asString();
        assertEquals("READY", s.get("status").asString());
        assertEquals(1500, s.get("durationSec").asInt());
        assertEquals(1500, s.get("remainingSec").asInt());
        assertEquals(sid, api("dave", "POST", "/plans/" + p + "/focus").body().get("id").asString());
        // 진입 후 10분 지나도 ▶ 전엔 그대로
        db.sql("update focus_sessions set created_at = now() - interval '10 minutes' where id = cast(:id as uuid)").param("id", sid).update();
        assertEquals(1500, api("dave", "GET", "/focus/" + sid).body().get("remainingSec").asInt());
        assertEquals(409, api("dave", "POST", "/plans/" + p + "/reward").status());
        assertEquals(409, api("dave", "POST", "/focus/" + sid + "/complete").status());

        assertEquals("RUNNING", api("dave", "POST", "/focus/" + sid + "/start").body().get("status").asString());
        db.sql("update focus_sessions set started_at = started_at - interval '300 seconds' where id = cast(:id as uuid)").param("id", sid).update();
        int left = api("dave", "GET", "/focus/" + sid).body().get("remainingSec").asInt();
        assertTrue(left <= 1200 && left >= 1198, "remaining " + left);

        var paused = api("dave", "POST", "/focus/" + sid + "/pause").body();
        assertEquals("PAUSED", paused.get("status").asString());
        db.sql("update focus_sessions set started_at = started_at - interval '600 seconds', paused_at = paused_at - interval '600 seconds' where id = cast(:id as uuid)")
            .param("id", sid).update();
        assertEquals(paused.get("remainingSec").asInt(), api("dave", "GET", "/focus/" + sid).body().get("remainingSec").asInt());
        var resumed = api("dave", "POST", "/focus/" + sid + "/resume").body();
        assertTrue(Math.abs(resumed.get("remainingSec").asInt() - paused.get("remainingSec").asInt()) <= 1);

        var done = parallel(5, () -> send("dave", "POST", "/focus/" + sid + "/complete", null));
        assertTrue(done.stream().allMatch(r -> r.status() == 200 && r.body().get("status").asString().equals("COMPLETED")));
        var planNow = api("dave", "GET", "/plans?from=2026-11-23&to=2026-11-23").body().get(0);
        assertTrue(planNow.get("done").asBoolean());
        assertEquals(2, planNow.get("version").asInt());

        var claims = parallel(10, () -> send("dave", "POST", "/plans/" + p + "/reward", null));
        assertEquals(1, claims.stream().filter(r -> r.body().get("granted").asBoolean()).count());
        assertEquals(5, api("dave", "GET", "/rewards").body().get("balance").asInt());

        // 완료 취소 → 다시 집중 → 재완료 → 추가 지급 없음
        api("dave", "PATCH", "/plans/" + p, Map.of("done", false));
        var s2 = api("dave", "POST", "/plans/" + p + "/focus").body().get("id").asString();
        assertNotEquals(sid, s2);
        api("dave", "POST", "/focus/" + s2 + "/start");
        api("dave", "POST", "/focus/" + s2 + "/complete");
        var again = api("dave", "POST", "/plans/" + p + "/reward").body();
        assertFalse(again.get("granted").asBoolean());
        assertEquals(5, again.get("balance").asInt());
        api("dave", "DELETE", "/plans/" + p);
        assertEquals(5, api("dave", "GET", "/me").body().get("coins").asInt());
    }

    @Test
    void 넘기기_후_완료_보상_불가() {
        var p = api("erin", "POST", "/plans", plan()).body().get("id").asString();
        var s = api("erin", "POST", "/plans/" + p + "/focus").body().get("id").asString();
        assertEquals("SKIPPED", api("erin", "POST", "/focus/" + s + "/skip").body().get("status").asString());
        assertEquals(409, api("erin", "POST", "/focus/" + s + "/start").status());
        assertEquals(409, api("erin", "POST", "/plans/" + p + "/reward").status());
        assertEquals(404, api("erin", "POST", "/focus/" + s + "/dance").status());
    }

    @Test
    void 목표_CRUD() {
        var g = api("frank", "POST", "/goals", Map.of("title", "모의고사", "date", "2026-12-01")).body();
        assertEquals("2026-12-01", g.get("date").asString());
        var u = api("frank", "PATCH", "/goals/" + g.get("id").asString(), Map.of("done", true, "date", "")).body();
        assertTrue(u.get("done").asBoolean());
        assertTrue(u.get("date").isNull());
        assertEquals("모의고사", u.get("title").asString());
        assertEquals(1, api("frank", "GET", "/goals").body().size());
        assertEquals(204, api("frank", "DELETE", "/goals/" + g.get("id").asString()).status());
    }

    @Test
    void 설문_사분면_4유형() {
        Object[][] cases = {{List.of(2), 0, "calm_designer"}, {List.of(0), 0, "steady_doer"}, {List.of(3), 1, "free_explorer"},
            {List.of(1, 2), 1, "flexible_challenger"}, {List.of(0), null, null}};
        for (var c : cases) {
            var body = new HashMap<String, Object>();
            body.put("q1", 1); body.put("q2", c[0]); body.put("q3", c[1]);
            var r = api("gina", "POST", "/survey", body);
            assertEquals(201, r.status());
            var result = r.body().get("result");
            assertEquals(c[2], result.isNull() ? null : result.get("type").asString());
        }
        assertTrue(api("gina", "GET", "/survey/latest").body().get("result").isNull());
        assertEquals(400, api("gina", "POST", "/survey", Map.of("q1", 9, "q2", List.of(0, 0), "q3", 2)).status());
        assertEquals(400, api("gina", "POST", "/survey", Map.of("q1", 1, "q2", List.of(0, 0), "q3", 1)).status());
    }

    @Test
    void 설정_프로필_타임존_선호() {
        var me = api("hana", "GET", "/me").body();
        assertEquals("Asia/Seoul", me.get("timeZone").asString());
        assertEquals("system", me.get("preferences").get("theme").asString());
        assertEquals(0, me.get("coins").asInt());
        var prefs = Map.of("theme", "dark", "notifications", Map.of("enabled", true, "atStart", true, "before", 10, "sound", false));
        var u = api("hana", "PATCH", "/me", Map.of("displayName", "하나", "preferences", prefs)).body();
        assertEquals("하나", u.get("displayName").asString());
        assertEquals(10, u.get("preferences").get("notifications").get("before").asInt());
        assertEquals("dark", u.get("preferences").get("theme").asString());
        assertEquals(400, api("hana", "PATCH", "/me", Map.of("timeZone", "Mars/Base")).status());
        var bad = Map.of("theme", "dark", "notifications", Map.of("enabled", true, "atStart", true, "before", 7, "sound", false));
        assertEquals(400, api("hana", "PATCH", "/me", Map.of("preferences", bad)).status());
        api("hana", "POST", "/plans", plan("date", "2026-11-25"));
        api("hana", "PATCH", "/me", Map.of("timeZone", "UTC"));
        var p = api("hana", "GET", "/plans?from=2026-11-25&to=2026-11-25").body().get(0);
        assertEquals("01:00", p.get("start").asString());
    }
}
