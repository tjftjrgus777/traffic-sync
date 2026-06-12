package com.example.demo.repository;

import com.example.demo.entity.CrossroadEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CrossroadRepository extends JpaRepository<CrossroadEntity, String> {

    // Haversine 공식을 사용하여 특정 위치에서 반경 내에 있는 CCTV를 조회하는 쿼리
    // :lat, :lon, :radiusKm는 메서드 파라미터로 전달되는 값
    // 6371은 지구의 평균 반지름(킬로미터 단위)
    // SELECT c FROM CctvEntity c
    //WHERE (
    //    6371 *                          -- 지구 반지름 (km)
    //    acos(
    //        cos(radians(:lat)) *        -- 내 위도
    //        cos(radians(c.lat)) *       -- CCTV 위도
    //        cos(radians(c.lon) - radians(:lon)) +  -- 경도 차이
    //        sin(radians(:lat)) *        -- 내 위도
    //        sin(radians(c.lat))         -- CCTV 위도
    //    )
    //) <= :radiusKm                      -- 반경 안에 있는 것만
    //쉽게 말하면
    //내 위치(lat, lon) 기준으로
    //반경 radiusKm 안에 있는
    //CCTV 목록 가져와
    @Query("""
        SELECT c FROM CrossroadEntity c
        WHERE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
               cos(radians(:lat)) * cos(radians(c.lat)) *
               cos(radians(c.lon) - radians(:lon)) +
               sin(radians(:lat)) * sin(radians(c.lat)))))) <= :radiusKm
    """)
    List<CrossroadEntity> findWithinRadius(@Param("lat") double lat,
                                           @Param("lon") double lon,
                                           @Param("radiusKm") double radiusKm);
}
