package cloudnative.microservices.notification.config;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;

/**
 * Wires the AWS SDK v2 {@link SqsClient}. Created only when a queue URL is set
 * (ridenow.notifications.queue-url), so plain unit tests without a queue don't
 * need AWS. Config-driven so the same code targets LocalStack or real AWS by env:
 *   - AWS_REGION               : region.
 *   - AWS_ENDPOINT (optional)  : LocalStack endpoint; unset in real AWS.
 *   - AWS_ACCESS_KEY_ID /
 *     AWS_SECRET_ACCESS_KEY    : when both are set (LocalStack test creds), use
 *                                them directly; otherwise fall back to the default
 *                                provider chain (IAM role / env) in real AWS.
 */
@Configuration
@ConditionalOnProperty(name = "ridenow.notifications.queue-url")
public class AwsSqsConfig {

    @Bean
    SqsClient sqsClient(
            @Value("${AWS_REGION:ap-southeast-1}") String region,
            @Value("${AWS_ENDPOINT:}") String endpoint,
            @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
            @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey
    ) {
        var builder = SqsClient.builder()
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
