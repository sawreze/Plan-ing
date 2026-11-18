package app.pling;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 일정 CRUD · 집중 세션 · 5코인 원장. */
@RestController
public class PlanController {
    static final String DATE = "^\\d{4}-\\d{2}-\\d{2}$", TIME = "^([01]\\d|2[0-3]):[0-5]\\d$", COLOR = "^#[0-9A-Fa-f]{6}$";

    record PlanInput(@NotNull @Size(min = 1, max = 60) String title, @NotNull @Pattern(regexp = DATE) String date,
                     @NotNull @Pattern(regexp = TIME) String start, @NotNull @Pattern(regexp = TIME) String end,
                     @NotNull @Pattern(regexp = COLOR) String color) {}

    record PlanPatch(@Size(min = 1, max = 60) String title, @Pattern(regexp = DATE) String date, @Pattern(regexp = TIME) String start,
                     @Pattern(regexp = TIME) String end, @Pattern(regexp = COLOR) String color, Boolean done, Integer version) {}

    // 응답은 HTML events와 같은 date/start/end 문자열과 ISO 시각을 함께 준다. :tz = 사용자 time_zone
    static final String PLAN_COLS = """
        id, title, color, done, version,
        to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') "startAt",
        to_char(end_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') "endAt",
        to_char(start_at at time zone :tz, 'YYYY-MM-DD') date, to_char(start_at at time zone :tz, 'HH24:MI') start,
        to_char(end_at at time zone :tz, 'HH24:MI') "end" """;
    static String at(String d, String t) { return "(cast(:" + d + " as date) + cast(:" + t + " as time)) at time zone :tz"; }

    static final String SESSION_COLS = """
        id, plan_id "planId", status, duration_sec "durationSec", started_at is not null "started",
        case when status = 'COMPLETED' then 0 else greatest(0, duration_sec - case when started_at is null then 0 else
          extract(epoch from coalesce(ended_at, paused_at, now()) - started_at)::int - paused_total_sec end) end "remainingSec" """;

    static final String REWARD_REASON = "focus_complete";
    static final int REWARD_AMOUNT = 5;

    private final JdbcClient db;
    PlanController(JdbcClient db) { this.db = db; }

    static int minutes(String t) { return Integer.parseInt(t.substring(0, 2)) * 60 + Integer.parseInt(t.substring(3)); }
    static ResponseStatusException err(HttpStatus s, String m) { return new ResponseStatusException(s, m); }
    static void checkTimes(String start, String end) {
        // 자정을 넘는 일정은 현재 UI와 같이 지원하지 않는다.
        if (minutes(end) <= minutes(start)) throw err(HttpStatus.BAD_REQUEST, "끝 시간을 시작 시간 뒤로 정해주세요");
    }
    static LocalDate date(String s) {
        try { return LocalDate.parse(s); } catch (Exception e) { throw err(HttpStatus.BAD_REQUEST, "날짜를 확인해주세요"); }
    }

    @GetMapping("/plans")
    List<Map<String, Object>> list(AuthUser u, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        var f = from == null ? null : date(from);
        var t = to == null ? null : date(to);
        if (f != null && t != null) {
            long days = ChronoUnit.DAYS.between(f, t);
            if (days < 0 || days > 62) throw err(HttpStatus.BAD_REQUEST, "조회 기간은 0~62일이에요");
        }
        return db.sql("select " + PLAN_COLS + """
                 from plans where user_id = :uid
                  and start_at >= coalesce(cast(:from as date), (now() at time zone :tz)::date) at time zone :tz
                  and start_at < (coalesce(cast(:to as date), cast(:from as date), (now() at time zone :tz)::date) + 1) at time zone :tz
                order by start_at""")
            .param("uid", u.id()).param("tz", u.timeZone()).param("from", from).param("to", to)
            .query().listOfRows();
    }

    @PostMapping("/plans")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> create(AuthUser u, @Valid @RequestBody PlanInput p) {
        var title = p.title().trim();
        if (title.isEmpty()) throw err(HttpStatus.BAD_REQUEST, "이름을 적어주세요");
        date(p.date());
        checkTimes(p.start(), p.end());
        return db.sql("insert into plans (user_id, title, start_at, end_at, color) values (:uid, :title, " + at("date", "start") + ", "
                + at("date", "end") + ", :color) returning " + PLAN_COLS)
            .param("uid", u.id()).param("tz", u.timeZone()).param("title", title).param("date", p.date())
            .param("start", p.start()).param("end", p.end()).param("color", p.color())
            .query().singleRow();
    }

    @PatchMapping("/plans/{id}")
    @Transactional
    Map<String, Object> update(AuthUser u, @PathVariable String id, @Valid @RequestBody PlanPatch p) {
        var cur = db.sql("select " + PLAN_COLS + " from plans where id = cast(:id as uuid) and user_id = :uid for update")
            .param("id", id).param("uid", u.id()).param("tz", u.timeZone()).query().listOfRows();
        if (cur.isEmpty()) throw err(HttpStatus.NOT_FOUND, "계획을 찾을 수 없어요");
        var c = cur.getFirst();
        // 다른 기기/AI 제안이 먼저 바꿨으면 덮어쓰지 않는다.
        if (p.version() != null && !p.version().equals(c.get("version")))
            throw err(HttpStatus.CONFLICT, "다른 곳에서 계획이 바뀌었어요");
        var title = p.title() == null ? (String) c.get("title") : p.title().trim();
        if (title.isEmpty()) throw err(HttpStatus.BAD_REQUEST, "이름을 적어주세요");
        var d = p.date() == null ? (String) c.get("date") : p.date();
        var s = p.start() == null ? (String) c.get("start") : p.start();
        var e = p.end() == null ? (String) c.get("end") : p.end();
        date(d);
        checkTimes(s, e);
        return db.sql("update plans set title = :title, start_at = " + at("date", "start") + ", end_at = " + at("date", "end")
                + ", color = :color, done = :done, version = version + 1, updated_at = now() where id = cast(:id as uuid) and user_id = :uid returning " + PLAN_COLS)
            .param("uid", u.id()).param("tz", u.timeZone()).param("id", id).param("title", title).param("date", d)
            .param("start", s).param("end", e).param("color", p.color() == null ? c.get("color") : p.color())
            .param("done", p.done() == null ? c.get("done") : p.done())
            .query().singleRow();
    }

    @DeleteMapping("/plans/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void remove(AuthUser u, @PathVariable String id) {
        if (db.sql("delete from plans where id = cast(:id as uuid) and user_id = :uid").param("id", id).param("uid", u.id()).update() == 0)
            throw err(HttpStatus.NOT_FOUND, "계획을 찾을 수 없어요");
    }

    /** 집중창 열기: READY 세션만 만든다. 시간은 ▶(start) 전까지 흐르지 않는다. */
    @PostMapping("/plans/{id}/focus")
    @Transactional
    Map<String, Object> openFocus(AuthUser u, @PathVariable String id) {
        var plan = db.sql("select done, extract(epoch from end_at - start_at)::int sec from plans where id = cast(:id as uuid) and user_id = :uid for update")
            .param("id", id).param("uid", u.id()).query().listOfRows();
        if (plan.isEmpty()) throw err(HttpStatus.NOT_FOUND, "계획을 찾을 수 없어요");
        var active = db.sql("select " + SESSION_COLS + " from focus_sessions where plan_id = cast(:id as uuid) and status in ('READY','RUNNING','PAUSED')")
            .param("id", id).query().listOfRows();
        if (!active.isEmpty()) return active.getFirst();
        if ((Boolean) plan.getFirst().get("done")) throw err(HttpStatus.CONFLICT, "이미 완료한 계획이에요");
        return db.sql("insert into focus_sessions (user_id, plan_id, duration_sec) values (:uid, cast(:id as uuid), :sec) returning " + SESSION_COLS)
            .param("uid", u.id()).param("id", id).param("sec", plan.getFirst().get("sec")).query().singleRow();
    }

    @GetMapping("/focus/{id}")
    Map<String, Object> getFocus(AuthUser u, @PathVariable String id) {
        var r = db.sql("select " + SESSION_COLS + " from focus_sessions where id = cast(:id as uuid) and user_id = :uid")
            .param("id", id).param("uid", u.id()).query().listOfRows();
        if (r.isEmpty()) throw err(HttpStatus.NOT_FOUND, "집중 기록을 찾을 수 없어요");
        return r.getFirst();
    }

    record Transition(List<String> from, String to, String set) {}
    static final String FOLD = "paused_total_sec = paused_total_sec + coalesce(extract(epoch from now() - paused_at)::int, 0), paused_at = null";
    static final Map<String, Transition> TRANSITIONS = Map.of(
        "start", new Transition(List.of("READY"), "RUNNING", "started_at = now()"),
        "pause", new Transition(List.of("RUNNING"), "PAUSED", "paused_at = now()"),
        "resume", new Transition(List.of("PAUSED"), "RUNNING", FOLD),
        // 현재 UI 정책: 시간 종료 또는 수동 ✓(조기 완료) 모두 완료. 조기 완료 보상 제한은 미결정 제품 정책.
        "complete", new Transition(List.of("RUNNING", "PAUSED"), "COMPLETED", FOLD + ", ended_at = now()"),
        "skip", new Transition(List.of("READY", "RUNNING", "PAUSED"), "SKIPPED", FOLD + ", ended_at = now()"));

    /** 상태 전환. 같은 요청 재전송(연타·네트워크 재시도)은 현재 상태를 그대로 돌려준다. */
    @PostMapping("/focus/{id}/{action}")
    @Transactional
    Map<String, Object> act(AuthUser u, @PathVariable String id, @PathVariable String action) {
        var rule = TRANSITIONS.get(action);
        if (rule == null) throw err(HttpStatus.NOT_FOUND, "찾을 수 없어요");
        var s = db.sql("select status, plan_id from focus_sessions where id = cast(:id as uuid) and user_id = :uid for update")
            .param("id", id).param("uid", u.id()).query().listOfRows();
        if (s.isEmpty()) throw err(HttpStatus.NOT_FOUND, "집중 기록을 찾을 수 없어요");
        var status = (String) s.getFirst().get("status");
        if (!status.equals(rule.to())) {
            if (!rule.from().contains(status)) throw err(HttpStatus.CONFLICT, "지금 상태(" + status + ")에서는 할 수 없어요");
            db.sql("update focus_sessions set status = :to, " + rule.set() + " where id = cast(:id as uuid)").param("to", rule.to()).param("id", id).update();
            if (rule.to().equals("COMPLETED"))
                db.sql("update plans set done = true, version = version + 1, updated_at = now() where id = :pid and not done")
                    .param("pid", s.getFirst().get("plan_id")).update();
        }
        return db.sql("select " + SESSION_COLS + " from focus_sessions where id = cast(:id as uuid)").param("id", id).query().singleRow();
    }

    /** 5코인 수령. 완료된 집중 세션이 있어야 하고, (user, plan, reason) 유일 키로 한 번만 지급된다. */
    @PostMapping("/plans/{id}/reward")
    Map<String, Object> claim(AuthUser u, @PathVariable String id) {
        var s = db.sql("select id from focus_sessions where plan_id = cast(:id as uuid) and user_id = :uid and status = 'COMPLETED' limit 1")
            .param("id", id).param("uid", u.id()).query(UUID.class).optional();
        if (s.isEmpty()) throw err(HttpStatus.CONFLICT, "집중을 완료한 계획만 보상을 받을 수 있어요");
        int ins = db.sql("insert into reward_ledger (user_id, plan_id, session_id, reason, amount) values (:uid, cast(:id as uuid), :sid, :reason, :amount) on conflict do nothing")
            .param("uid", u.id()).param("id", id).param("sid", s.get()).param("reason", REWARD_REASON).param("amount", REWARD_AMOUNT).update();
        return Map.of("granted", ins == 1, "amount", REWARD_AMOUNT, "balance", balance(u.id()));
    }

    @GetMapping("/rewards")
    Map<String, Object> rewards(AuthUser u) {
        var ledger = db.sql("select plan_id \"planId\", reason, amount, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \"createdAt\" from reward_ledger where user_id = :uid order by id desc limit 50")
            .param("uid", u.id()).query().listOfRows();
        var r = new HashMap<String, Object>();
        r.put("balance", balance(u.id()));
        r.put("ledger", ledger);
        return r;
    }

    int balance(UUID userId) {
        return db.sql("select coalesce(sum(amount), 0)::int from reward_ledger where user_id = :uid").param("uid", userId).query(Integer.class).single();
    }
}
