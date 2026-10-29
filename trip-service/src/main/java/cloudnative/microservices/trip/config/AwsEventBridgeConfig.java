package cloudnative.microservices.trip.config;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;

/**
 * Wires the AWS SDK v2 {@link EventBridgeClient}, active only under the
 * "eventbridge" profile so plain unit tests and no-AWS local runs keep using the
 * logging publisher.
 *
 * Config-driven, so the same code targets LocalStack or real AWS by env only:
 *   - AWS_REGION               : the region (also used by LocalStack).
 *   - AWS_ENDPOINT (optional)  : when set (e.g. http://localstack:4566), the client
 *                                talks to LocalStack; unset in real AWS.
 *   - AWS_ACCESS_KEY_ID /
 *     AWS_SECRET_ACCESS_KEY    : when both set (LocalStack test creds) use them;
 *                                otherwise the default provider chain (IAM role).
 */
@Configuration
@Profile("eventbridge")
public class AwsEventBridgeConfig {

    @Bean
    EventBridgeClient eventBridgeClient(
            @Value("${AWS_REGION:ap-southeast-1}") String region,
            @Value("${AWS_ENDPOINT:}") String endpoint,
            @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
            @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey
    ) {
        var builder = EventBridgeClient.builder()
                .region(Region.of(region))
                .credentialsProvider(credentials(accessKey, secretKey));
        if (StringUtils.hasText(endpoint)) {
            builder = builder.endpointOverride(URI.create(endpoint));
        }
        return builder.build();
    }

    private AwsCredentialsProvider credentials(String accessKey, String secretKey) {
        if (StringUtils.hasText(accessKey) && StringUtils.hasText(secretKey)) {
            return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
        }
        return DefaultCredentialsProvider.create();
    }
}
