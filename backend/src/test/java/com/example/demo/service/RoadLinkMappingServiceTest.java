package com.example.demo.service;

import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.GeoPoint;
import com.example.demo.model.context.TopisLinkGeometry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RoadLinkMappingServiceTest {

    private final RoadLinkMappingService service = new RoadLinkMappingService();

    @Test
    void mapsCrossroadToNearestLinkWithinThreshold() {
        ReflectionTestUtils.setField(service, "maxMatchDistanceMeters", 150.0);

        CrossroadInfo crossroad = new CrossroadInfo();
        crossroad.setCrsrdId("C1");
        crossroad.setCrsrdNm("잠실3사거리");
        crossroad.setLat(37.5133);
        crossroad.setLon(127.1002);

        TopisLinkGeometry nearby = TopisLinkGeometry.builder()
                .linkId("L1")
                .vertices(List.of(
                        new GeoPoint(37.5130, 127.1000),
                        new GeoPoint(37.5135, 127.1005)
                ))
                .build();

        Map<String, CrossroadRoadLinkMapping> mappings =
                service.mapCrossroadsToNearestLinks(List.of(crossroad), List.of(nearby));

        assertThat(mappings).containsKey("C1");
        assertThat(mappings.get("C1").getLinkId()).isEqualTo("L1");
        assertThat(mappings.get("C1").getDistanceMeters()).isLessThan(50);
        assertThat(mappings.get("C1").getLineString()).startsWith("LineString(");
    }

    @Test
    void doesNotMapCrossroadWhenNearestLinkIsTooFar() {
        ReflectionTestUtils.setField(service, "maxMatchDistanceMeters", 10.0);

        CrossroadInfo crossroad = new CrossroadInfo();
        crossroad.setCrsrdId("C1");
        crossroad.setLat(37.5133);
        crossroad.setLon(127.1002);

        TopisLinkGeometry far = TopisLinkGeometry.builder()
                .linkId("L1")
                .vertices(List.of(
                        new GeoPoint(37.5200, 127.1200),
                        new GeoPoint(37.5210, 127.1210)
                ))
                .build();

        Map<String, CrossroadRoadLinkMapping> mappings =
                service.mapCrossroadsToNearestLinks(List.of(crossroad), List.of(far));

        assertThat(mappings).isEmpty();
    }

    @Test
    void mapsCrossroadToNearestLinksByDirection() {
        ReflectionTestUtils.setField(service, "maxMatchDistanceMeters", 30.0);

        CrossroadInfo crossroad = new CrossroadInfo();
        crossroad.setCrsrdId("C1");
        crossroad.setLat(37.0000);
        crossroad.setLon(127.0000);

        // 각 링크는 교차로(37.0000, 127.0000) 기준으로 정 북/동/남/서 방향에 배치.
        // far endpoint가 명확히 해당 방위를 가리키도록 가까운 점 → 먼 점 순서로 배치.
        TopisLinkGeometry north = TopisLinkGeometry.builder()
                .linkId("LN")
                .vertices(List.of(
                        new GeoPoint(37.0002, 127.0000),
                        new GeoPoint(37.0003, 127.0000)
                ))
                .build();
        TopisLinkGeometry east = TopisLinkGeometry.builder()
                .linkId("LE")
                .vertices(List.of(
                        new GeoPoint(37.0000, 127.0002),
                        new GeoPoint(37.0000, 127.0003)
                ))
                .build();
        TopisLinkGeometry south = TopisLinkGeometry.builder()
                .linkId("LS")
                .vertices(List.of(
                        new GeoPoint(36.9998, 127.0000),
                        new GeoPoint(36.9997, 127.0000)
                ))
                .build();
        TopisLinkGeometry west = TopisLinkGeometry.builder()
                .linkId("LW")
                .vertices(List.of(
                        new GeoPoint(37.0000, 126.9998),
                        new GeoPoint(37.0000, 126.9997)
                ))
                .build();

        Map<String, Map<String, CrossroadRoadLinkMapping>> mappings =
                service.mapCrossroadsToDirectionalLinks(List.of(crossroad), List.of(north, east, south, west),
                        Map.of("C1", Set.of("nt", "et", "st", "wt")));

        assertThat(mappings).containsKey("C1");
        assertThat(mappings.get("C1")).containsKeys("nt", "et", "st", "wt");
        assertThat(mappings.get("C1").get("nt").getLinkId()).isEqualTo("LN");
        assertThat(mappings.get("C1").get("et").getLinkId()).isEqualTo("LE");
        assertThat(mappings.get("C1").get("st").getLinkId()).isEqualTo("LS");
        assertThat(mappings.get("C1").get("wt").getLinkId()).isEqualTo("LW");
    }
}
