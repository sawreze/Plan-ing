package app.pling;

import java.sql.SQLException;
import java.util.Map;

import org.springframework.core.NestedExceptionUtils;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** pg 오류를 사용자 응답으로 바꾸고, 예상 못한 오류는 내용 없이 500으로 숨긴다. */
@RestControllerAdvice
public class ApiErrors {
    record Err(int status, String message) {}

    static final Map<String, Err> PG = Map.of(
        "23P01", new Err(409, "시간이 겹치는 계획이 있어요. 다른 시간으로 정해주세요. 색깔은 같아도 괜찮아요."),
        "23514", new Err(400, "입력값을 확인해주세요"),
        "22008", new Err(400, "날짜를 확인해주세요"),
        "22007", new Err(400, "날짜를 확인해주세요"),
        "22P02", new Err(404, "찾을 수 없어요"));

    static ResponseEntity<Map<String, Object>> body(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("message", message));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, Object>> status(ResponseStatusException e) {
        return body(e.getStatusCode().value(), e.getReason() == null ? "" : e.getReason());
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, Object>> invalid(Exception e) {
        return body(400, "입력값을 확인해주세요");
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, Object>> notFound() { return body(404, "찾을 수 없어요"); }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, Object>> db(DataAccessException e) {
        if (NestedExceptionUtils.getMostSpecificCause(e) instanceof SQLException s && PG.containsKey(s.getSQLState())) {
            var m = PG.get(s.getSQLState());
            return body(m.status(), m.message());
        }
        org.slf4j.LoggerFactory.getLogger(ApiErrors.class).error("db error", e);
        return body(500, "잠시 후 다시 시도해주세요");
    }
}
