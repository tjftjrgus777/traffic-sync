package com.example.demo.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class CrossroadDirectionLinkId implements Serializable {

    @Column(name = "CRSRD_ID")
    private String crsrdId;

    // 신호 방향 키와 동일: nt/et/st/wt/ne/se/sw/nw
    @Column(name = "DIRECTION_CODE")
    private String directionCode;
}
