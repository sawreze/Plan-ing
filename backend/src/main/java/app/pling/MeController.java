package app.pling;

import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** 프로필·설정, 개인 목표, 설문 사분면. */
@RestController
public class MeController {
    private final JdbcClient db;
    private final JsonMapper json;
    private final PlanController plans;

    MeController(JdbcClient db, JsonMapper json, PlanController plans) { this.db = db; this.json = json; this.plans = plans; }

    static ResponseStatusException err(HttpStatus s, String m) { return new ResponseStatusException(s, m); }

    // ---- 프로필 · 설정 ----
    // OS 알림 권한과 별개인 사용자 선호. 기기 토큰은 5단계에서 devices 테이블로 분리.
    record Notifications(@NotNull Boolean enabled, @NotNull Boolean atStart, @NotNull Integer before, @NotNull Boolean sound) {}
    record Preferences(@NotNull @Pattern(regexp = "light|dark|system") String theme, @NotNull @Valid Notifications notifications) {}
    /** null = 바꾸지 않음. displayName ""이면 지움. */
    record ProfilePatch(@Size(max = 30) String displayName, String timeZone, @Valid Preferences preferences) {}

    @GetMapping("/me")
    Map<String, Object> me(AuthUser u) {
        var r = db.sql("select display_name, time_zone, preferences::text prefs from profiles where id = :uid").param("uid", u.id()).query().singleRow();
        var out = new HashMap<String, Object>();
        out.put("displayName", r.get("display_name"));
        out.put("timeZone", r.get("time_zone"));
        out.put("preferences", json.readValue((String) r.get("prefs"), Map.class));
        out.put("coins", plans.balance(u.id()));
        return out;
    }

    @PatchMapping("/me")
    Map<String, Object> updateMe(AuthUser u, @Valid @RequestBody ProfilePatch p) {
        if (p.timeZone() != null) {
            try { ZoneId.of(p.timeZone()); } catch (Exception e) { throw err(HttpStatus.BAD_REQUEST, "알 수 없는 시간대예요"); }
        }
        if (p.preferences() != null && !Set.of(0, 5, 10, 15).contains(p.preferences().notifications().before()))
            throw err(HttpStatus.BAD_REQUEST, "미리 알림은 0·5·10·15분 중에서 골라주세요");
        var name = p.displayName() == null ? null : p.displayName().trim();
        db.sql("""
                update profiles set display_name = case when :setName then nullif(:name, '') else display_name end,
                  time_zone = coalesce(:tz, time_zone), preferences = coalesce(cast(:prefs as jsonb), preferences) where id = :uid""")
            .param("uid", u.id()).param("setName", name != null).param("name", name).param("tz", p.timeZone())
            .param("prefs", p.preferences() == null ? null : json.writeValueAsString(p.preferences()))
            .update();
        return me(u);
    }

    // ---- 목표 ----
    static final String GOAL_COLS = "id, title, to_char(date, 'YYYY-MM-DD') date, done";
    record GoalInput(@NotNull @Size(min = 1, max = 60) String title, @Pattern(regexp = PlanController.DATE) String date) {}
    /** null = 바꾸지 않음. date ""이면 목표일을 지움. */
    record GoalPatch(@Size(min = 1, max = 60) String title, @Pattern(regexp = "^$|" + PlanController.DATE) String date, Boolean done) {}

    @GetMapping("/goals")
    List<Map<String, Object>> goals(AuthUser u) {
        return db.sql("select " + GOAL_COLS + " from goals where user_id = :uid order by created_at").param("uid", u.id()).query().listOfRows();
    }

    @PostMapping("/goals")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> createGoal(AuthUser u, @Valid @RequestBody GoalInput g) {
        if (g.title().isBlank()) throw err(HttpStatus.BAD_REQUEST, "목표를 적어주세요");
        return db.sql("insert into goals (user_id, title, date) values (:uid, :title, cast(:date as date)) returning " + GOAL_COLS)
            .param("uid", u.id()).param("title", g.title().trim()).param("date", g.date()).query().singleRow();
    }

    @PatchMapping("/goals/{id}")
    Map<String, Object> updateGoal(AuthUser u, @PathVariable String id, @Valid @RequestBody GoalPatch g) {
        if (g.title() != null && g.title().isBlank()) throw err(HttpStatus.BAD_REQUEST, "목표를 적어주세요");
        var r = db.sql("""
                update goals set title = coalesce(:title, title), date = case when :setDate then cast(nullif(:date, '') as date) else date end,
                  done = coalesce(:done, done) where id = cast(:id as uuid) and user_id = :uid returning """ + " " + GOAL_COLS)
            .param("id", id).param("uid", u.id()).param("title", g.title() == null ? null : g.title().trim())
            .param("setDate", g.date() != null).param("date", g.date()).param("done", g.done())
            .query().listOfRows();
        if (r.isEmpty()) throw err(HttpStatus.NOT_FOUND, "목표를 찾을 수 없어요");
        return r.getFirst();
    }

    @DeleteMapping("/goals/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteGoal(AuthUser u, @PathVariable String id) {
        if (db.sql("delete from goals where id = cast(:id as uuid) and user_id = :uid").param("id", id).param("uid", u.id()).update() == 0)
            throw err(HttpStatus.NOT_FOUND, "목표를 찾을 수 없어요");
    }

    // ---- 설문 → 공부 방식 사분면 ----
    // design/pling-app.html의 computeStudyType과 같은 규칙(v1). 진단·검사 점수가 아니다.
    static final int STUDY_RULE_VERSION = 1;
    record Answers(@Min(0) @Max(4) Integer q1, @NotNull @Size(max = 4) List<@NotNull @Min(0) @Max(3) Integer> q2, @Min(0) @Max(1) Integer q3) {}
    record StudyType(String type, String name, int x, int y) {}

    static StudyType computeStudyType(List<Integer> q2, Integer q3) {
        if (q3 == null) return null; // q3 미응답이면 결과 점을 숨긴다
        boolean guided = q2.contains(0) || q2.contains(1), reset = q3 == 0;
        String[] t = guided
            ? (reset ? new String[]{"steady_doer", "차근차근 실천가"} : new String[]{"flexible_challenger", "유연한 도전가"})
            : (reset ? new String[]{"calm_designer", "차분한 설계자"} : new String[]{"free_explorer", "자유로운 탐험가"});
        return new StudyType(t[0], t[1], guided ? 73 : 27, reset ? 27 : 73);
    }

    static Map<String, Object> surveyResult(Answers a) {
        var r = new HashMap<String, Object>();
        r.put("ruleVersion", STUDY_RULE_VERSION);
        r.put("answers", a);
        r.put("result", computeStudyType(a.q2(), a.q3()));
        return r;
    }

    @PostMapping("/survey")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> submitSurvey(AuthUser u, @Valid @RequestBody Answers a) {
        if (new HashSet<>(a.q2()).size() != a.q2().size()) throw err(HttpStatus.BAD_REQUEST, "같은 답을 두 번 고를 수 없어요");
        var result = computeStudyType(a.q2(), a.q3());
        db.sql("insert into survey_responses (user_id, rule_version, answers, study_type) values (:uid, :v, cast(:a as jsonb), :t)")
            .param("uid", u.id()).param("v", STUDY_RULE_VERSION).param("a", json.writeValueAsString(a))
            .param("t", result == null ? null : result.type()).update();
        return surveyResult(a);
    }

    @GetMapping("/survey/latest")
    Map<String, Object> latestSurvey(AuthUser u) {
        var r = db.sql("select answers::text from survey_responses where user_id = :uid order by created_at desc limit 1")
            .param("uid", u.id()).query(String.class).optional();
        if (r.isEmpty()) throw err(HttpStatus.NOT_FOUND, "아직 설문 답변이 없어요");
        return surveyResult(json.readValue(r.get(), Answers.class));
    }
}
