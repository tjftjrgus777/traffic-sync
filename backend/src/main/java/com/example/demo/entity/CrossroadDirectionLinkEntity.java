package com.example.demo.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 교차로의 방향(nt/et/st/wt/ne/se/sw/nw)별 진입 TOPIS 링크 매핑.
 * 교차로 1개당 최대 8행. 실시간 지도에서 방향별 속도를 보여주기 위한 매핑이며
 * 한 번 계산 후 영구 보관한다(재시작·구역변경 시 재계산 비용 절감).
 */
@Entity
@Table(name = "CROSSROAD_DIRECTION_LINK")
@Getter
@Setter
@NoArgsConstructor
public class CrossroadDirectionLinkEntity {

    @EmbeddedId
    private CrossroadDirectionLinkId id;

    // 해당 방향에서 교차로로 진입하는 TOPIS 링크 ID(속도 조회 키).
    @Column(name = "LINK_ID")
    private String linkId;

    // 교차로 중심에서 링크 최근접점까지 거리(m).
    @Column(name = "DISTANCE_METERS")
    private Double distanceMeters;

    // 중심 → 링크 최근접점 방위각(0~360°). 디버깅/검증용.
    @Column(name = "BEARING_DEGREES")
    private Double bearingDegrees;

    @Column(name = "UPDATED_AT_MS")
    private Long updatedAtMs;
}
