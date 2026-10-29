package cloudnative.microservices.trip.exception;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleResourceNotFound(
            ResourceNotFoundException exception,
            HttpServletRequest request
    ) {
        return build(HttpStatus.NOT_FOUND, exception.getMessage(), request);
    }

    // The business guard: trip was no longer SEARCHING when this driver tried to accept.
    @ExceptionHandler(TripNotAcceptableException.class)
    public ResponseEntity<ApiErrorResponse> handleNotAcceptable(
            TripNotAcceptableException exception,
            HttpServletRequest request
    ) {
        return build(HttpStatus.CONFLICT, exception.getMessage(), request);
    }

    // The business guard: trip was already in a terminal state when cancel was attempted.
    @ExceptionHandler(TripNotCancellableException.class)
    public ResponseEntity<ApiErrorResponse> handleNotCancellable(
            TripNotCancellableException exception,
            HttpServletRequest request
    ) {
        return build(HttpStatus.CONFLICT, exception.getMessage(), request);
    }

    // The business guard: an arrive/start/complete transition was illegal from
    // the trip's current status.
    @ExceptionHandler(TripTransitionException.class)
    public ResponseEntity<ApiErrorResponse> handleIllegalTransition(
            TripTransitionException exception,
            HttpServletRequest request
    ) {
        return build(HttpStatus.CONFLICT, exception.getMessage(), request);
    }

    // A @Valid request body failed bean validation. Report the first field error
    // as `field: message` and return a 400 client error.
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(
            MethodArgumentNotValidException exception, HttpServletRequest request) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(e -> e.getField() + ": " + e.getDefaultMessage())
                .orElse("Validation failed");
        return build(HttpStatus.BAD_REQUEST, message, request);
    }

    // A @Min/@Max etc. violation on a @RequestParam (via @Validated) surfaces here
    // rather than as MethodArgumentNotValidException. Treat it as a 400 client error.
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(
            ConstraintViolationException exception, HttpServletRequest request) {
        String message = exception.getConstraintViolations().stream()
                .findFirst()
                .map(v -> v.getMessage())
                .orElse("Validation failed");
        return build(HttpStatus.BAD_REQUEST, message, request);
    }

    // A query/path param that cannot be converted to its target type (e.g. an
    // unknown enum value or a non-numeric number). A client mistake -> 400.
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(
            MethodArgumentTypeMismatchException exception, HttpServletRequest request) {
        return build(HttpStatus.BAD_REQUEST, "Invalid value for parameter '" + exception.getName() + "'", request);
    }

    // The optimistic lock fired: another transaction updated the row first (version changed).
    // Same meaning to the caller: the ride was taken by someone else.
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiErrorResponse> handleOptimisticLock(
            OptimisticLockingFailureException exception,
            HttpServletRequest request
    ) {
        return build(HttpStatus.CONFLICT, "Trip was just taken by another driver", request);
    }

    // Safety net for a unique-constraint violation we did not pre-check. One
    // handler covers every constraint; we return a generic 409 rather than leak
    // the DB constraint name.
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleDataIntegrity(
            DataIntegrityViolationException exception, HttpServletRequest request) {
        log.warn("Data integrity violation on {}: {}", request.getRequestURI(), exception.getMostSpecificCause().getMessage());
        return build(HttpStatus.CONFLICT, "A resource with these details already exists", request);
    }

    // Final catch-all: anything unexpected becomes a clean 500. The real cause is
    // logged server-side only; the client never sees a stack trace or internals.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(
            Exception exception, HttpServletRequest request) {
        log.error("Unexpected error on {}", request.getRequestURI(), exception);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred", request);
    }

    private ResponseEntity<ApiErrorResponse> build(
            HttpStatus status, String message, HttpServletRequest request
    ) {
        ApiErrorResponse response = new ApiErrorResponse(
                Instant.now(), status.value(), status.getReasonPhrase(), message, request.getRequestURI()
        );
        return ResponseEntity.status(status).body(response);
    }
}