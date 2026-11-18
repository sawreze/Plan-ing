package app.pling;

import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
    private final JdbcClient db;
    HealthController(JdbcClient db) { this.db = db; }

    @GetMapping("/health")
    Map<String, Boolean> health() {
        db.sql("select 1").query(Integer.class).single();
        return Map.of("ok", true);
    }
}
