package cloudnative.microservices.realtime.channel;

import java.util.regex.Pattern;

/**
 * The one place that defines what a user's topic looks like. Both the server
 * (when pushing) and the inbound guard (when validating a subscription) use it,
 * so they cannot drift apart.
 *
 * The id must be a canonical lowercase UUID. That is a security requirement, not
 * tidiness: the simple broker matches destinations as Ant patterns, so a client
 * allowed to subscribe to {@code /topic/users/**} would receive EVERY user's
 * notifications.
 */
public final class Destinations {

    public static final String USER_TOPIC_PREFIX = "/topic/users/";

    private static final Pattern USER_TOPIC = Pattern.compile(
            "^/topic/users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    private Destinations() {
    }

    public static String forUser(String userId) {
        return USER_TOPIC_PREFIX + userId;
    }

    /** True only for an exact per-user topic (no wildcards, no other prefixes). */
    public static boolean isUserTopic(String destination) {
        return destination != null && USER_TOPIC.matcher(destination).matches();
    }
}
