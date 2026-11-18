package app.pling;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.spec.SecretKeySpec;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.http.HttpStatus;

@Configuration
public class SecurityConfig implements WebMvcConfigurer {
    @Value("${pling.auth.dev-secret}") String devSecret;
    @Value("${pling.auth.jwks-url}") String jwksUrl;
    @Value("${pling.auth.issuer}") String issuer;
    @Value("${pling.auth.audience}") String audience;
    @Value("${pling.cors-origins}") String corsOrigins;
    @Value("${spring.profiles.active:}") String profiles;

    private final JdbcClient db;

    SecurityConfig(JdbcClient db) { this.db = db; }

    boolean devMode() { return !devSecret.isBlank(); }

    SecretKeySpec devKey() {
        if (devSecret.length() < 32) throw new IllegalStateException("AUTH_DEV_SECRET는 32자 이상이어야 합니다");
        if (profiles.contains("prod")) throw new IllegalStateException("AUTH_DEV_SECRET는 운영에서 쓸 수 없습니다");
        return new SecretKeySpec(devSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(c -> c.disable()) // 쿠키 없이 Bearer 토큰만 쓰는 API
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/", "/index.html", "/health", "/dev/token", "/error").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
            .build();
    }

    @Bean
    JwtDecoder jwtDecoder() {
        NimbusJwtDecoder decoder;
        if (devMode()) decoder = NimbusJwtDecoder.withSecretKey(devKey()).macAlgorithm(MacAlgorithm.HS256).build();
        else if (!jwksUrl.isBlank()) decoder = NimbusJwtDecoder.withJwkSetUri(jwksUrl).build();
        else throw new IllegalStateException("AUTH_JWKS_URL 또는 (로컬 전용) AUTH_DEV_SECRET 중 하나가 필요합니다");
        List<OAuth2TokenValidator<Jwt>> v = new java.util.ArrayList<>();
        v.add(issuer.isBlank() ? JwtValidators.createDefault() : JwtValidators.createDefaultWithIssuer(issuer));
        if (!audience.isBlank()) v.add(new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(audience)));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(v));
        return decoder;
    }

    @Bean
    UrlBasedCorsConfigurationSource corsConfigurationSource() {
        var cfg = new CorsConfiguration();
        Arrays.stream(corsOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).forEach(cfg::addAllowedOrigin);
        cfg.addAllowedHeader("*");
        cfg.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE"));
        var src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }

    /** 컨트롤러 인자 AuthUser: 토큰 sub로 프로필을 찾고 없으면 만든다. */
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new HandlerMethodArgumentResolver() {
            public boolean supportsParameter(MethodParameter p) { return p.getParameterType() == AuthUser.class; }
            public Object resolveArgument(MethodParameter p, ModelAndViewContainer m, NativeWebRequest r, WebDataBinderFactory f) {
                if (!(SecurityContextHolder.getContext().getAuthentication().getPrincipal() instanceof Jwt jwt) || jwt.getSubject() == null)
                    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요해요");
                var row = (org.springframework.jdbc.core.RowMapper<AuthUser>) (rs, i) -> new AuthUser(rs.getObject(1, UUID.class), rs.getString(2));
                return db.sql("select id, time_zone from profiles where auth_sub = :sub").param("sub", jwt.getSubject()).query(row).optional()
                    // 첫 요청이 동시에 와도 do update는 상대 트랜잭션을 기다린 뒤 그 행을 돌려준다(do nothing은 빈 결과가 될 수 있음).
                    .orElseGet(() -> db.sql("insert into profiles(auth_sub) values (:sub) on conflict (auth_sub) do update set auth_sub = excluded.auth_sub returning id, time_zone")
                        .param("sub", jwt.getSubject()).query(row).single());
            }
        });
    }

    /** 로컬·에뮬레이터 확인용 로그인. AUTH_DEV_SECRET이 있을 때만 동작한다. 실제 Google/Apple 로그인 아님. */
    @RestController
    class DevTokenController {
        record DevLogin(String nickname) {}

        @PostMapping("/dev/token")
        Map<String, String> token(@RequestBody DevLogin body) {
            if (!devMode()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            var name = body.nickname() == null ? "" : body.nickname().trim();
            if (name.isEmpty() || name.length() > 30) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "닉네임을 1~30자로 적어주세요");
            var now = Instant.now();
            var claims = JwtClaimsSet.builder().subject("dev:" + name).issuedAt(now).expiresAt(now.plus(7, ChronoUnit.DAYS));
            if (!issuer.isBlank()) claims.issuer(issuer);
            if (!audience.isBlank()) claims.audience(List.of(audience));
            var jwt = new NimbusJwtEncoder(new ImmutableSecret<>(devKey()))
                .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build()));
            return Map.of("token", jwt.getTokenValue());
        }
    }
}
