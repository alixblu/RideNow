package cloudnative.microservices.payment.service;

import cloudnative.microservices.payment.dto.response.PaymentResponse;
import cloudnative.microservices.payment.entity.Payment;
import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.repository.PaymentRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentRepository paymentRepository;

    public PaymentResponse getPayment(UUID id) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Payment", id));
        return new PaymentResponse(
                payment.getId(), payment.getTripId(), payment.getAmount(), payment.getCurrency(), payment.getMethod(),
                payment.getStatus(), payment.getIdempotencyKey(), payment.getFailureReason(), payment.getCreatedAt(),
                payment.getUpdatedAt(), payment.getPaidAt(), payment.getFailedAt()
        );
    }
}
