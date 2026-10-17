package cloudnative.microservices.driver.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class HttpClientConfig {

    @Bean
    public RestClient userServiceRestClient(UserServiceProperties props) {
        return RestClient.builder().baseUrl(props.baseUrl()).build();
    }
}