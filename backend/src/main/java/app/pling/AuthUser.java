package app.pling;

import java.util.UUID;

/** 토큰의 sub로 찾은 사용자. 클라이언트가 보낸 user_id는 쓰지 않는다. */
public record AuthUser(UUID id, String timeZone) {}
