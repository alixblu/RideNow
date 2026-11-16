package cloudnative.microservices.notification.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void unreadableBodyIs400WithAGenericMessage() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/notifications/x");
        HttpMessageNotReadableException parseFailure = new HttpMessageNotReadableException(
                "JSON parse error: Unexpected end-of-input at line 1 column 11", mock(HttpInputMessage.class));

        ResponseEntity<ApiErrorResponse> response = handler.handleUnreadableBody(parseFailure, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().message()).isEqualTo("Malformed request body");
        assertThat(response.getBody().message()).doesNotContain("end-of-input");
    }
}
