package com.example.demo.service;

import com.example.demo.model.context.GeoPoint;

import java.util.List;

final class GeoDistanceUtils {

    private static final double EARTH_RADIUS_M = 6_371_000.0;
    private static final double METERS_PER_DEGREE_LAT = 111_320.0;

    private GeoDistanceUtils() {
    }

    // 두 지점 사이 방위각(0~360°). 진입 방향 계산에 사용한다.
    static double bearingBetween(GeoPoint from, GeoPoint to) {
        return bearingDegrees(from, to);
    }

    static double haversineMeters(GeoPoint a, GeoPoint b) {
        double dLat = Math.toRadians(b.getLat() - a.getLat());
        double dLon = Math.toRadians(b.getLon() - a.getLon());
        double lat1 = Math.toRadians(a.getLat());
        double lat2 = Math.toRadians(b.getLat());
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(lat1) * Math.cos(lat2)
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    static double distanceToPolylineMeters(GeoPoint point, List<GeoPoint> vertices) {
        return closestPointOnPolyline(point, vertices).distanceMeters();
    }

    static ClosestPoint closestPointOnPolyline(GeoPoint point, List<GeoPoint> vertices) {
        if (vertices == null || vertices.isEmpty()) {
            return new ClosestPoint(Double.MAX_VALUE, null, Double.NaN, Double.NaN);
        }
        if (vertices.size() == 1) {
            double distance = haversineMeters(point, vertices.get(0));
            return new ClosestPoint(distance, vertices.get(0), bearingDegrees(point, vertices.get(0)), Double.NaN);
        }

        double metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(Math.toRadians(point.getLat()));
        double px = point.getLon() * metersPerDegreeLon;
        double py = point.getLat() * METERS_PER_DEGREE_LAT;

        double best = Double.MAX_VALUE;
        GeoPoint closestPoint = null;
        int bestSegmentIndex = -1;
        for (int i = 0; i < vertices.size() - 1; i++) {
            SegmentProjection projection = pointToSegment(point, vertices.get(i), vertices.get(i + 1));
            if (projection.distanceMeters() < best) {
                best = projection.distanceMeters();
                closestPoint = projection.closestPoint();
                bestSegmentIndex = i;
            }
        }

        GeoPoint bearingPoint = closestPoint;
        if (best < 1.0) {
            GeoPoint nearestVertex = nearestVertex(point, vertices);
            if (nearestVertex != null) {
                double vx = nearestVertex.getLon() * metersPerDegreeLon;
                double vy = nearestVertex.getLat() * METERS_PER_DEGREE_LAT;
                if (Math.hypot(px - vx, py - vy) >= 1.0) {
                    bearingPoint = nearestVertex;
                }
            }
        }

        // 링크 진행 방향(정점 i → i+1)의 방위각. 진입/진출(상행/하행) 구분에 사용한다.
        double segmentBearing = bestSegmentIndex < 0
                ? Double.NaN
                : bearingDegrees(vertices.get(bestSegmentIndex), vertices.get(bestSegmentIndex + 1));

        return new ClosestPoint(best, closestPoint, bearingDegrees(point, bearingPoint), segmentBearing);
    }

    private static SegmentProjection pointToSegment(GeoPoint point, GeoPoint start, GeoPoint end) {
        double metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(Math.toRadians(point.getLat()));

        double px = point.getLon() * metersPerDegreeLon;
        double py = point.getLat() * METERS_PER_DEGREE_LAT;
        double ax = start.getLon() * metersPerDegreeLon;
        double ay = start.getLat() * METERS_PER_DEGREE_LAT;
        double bx = end.getLon() * metersPerDegreeLon;
        double by = end.getLat() * METERS_PER_DEGREE_LAT;

        double dx = bx - ax;
        double dy = by - ay;
        if (dx == 0 && dy == 0) {
            return new SegmentProjection(
                    Math.hypot(px - ax, py - ay),
                    new GeoPoint(start.getLat(), start.getLon())
            );
        }

        double t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        double closestX = ax + t * dx;
        double closestY = ay + t * dy;
        return new SegmentProjection(
                Math.hypot(px - closestX, py - closestY),
                new GeoPoint(closestY / METERS_PER_DEGREE_LAT, closestX / metersPerDegreeLon)
        );
    }

    private static GeoPoint nearestVertex(GeoPoint point, List<GeoPoint> vertices) {
        GeoPoint nearest = null;
        double best = Double.MAX_VALUE;
        for (GeoPoint vertex : vertices) {
            double distance = haversineMeters(point, vertex);
            if (distance < best) {
                best = distance;
                nearest = vertex;
            }
        }
        return nearest;
    }

    private static double bearingDegrees(GeoPoint from, GeoPoint to) {
        if (from == null || to == null) {
            return Double.NaN;
        }

        double lat1 = Math.toRadians(from.getLat());
        double lat2 = Math.toRadians(to.getLat());
        double dLon = Math.toRadians(to.getLon() - from.getLon());
        double y = Math.sin(dLon) * Math.cos(lat2);
        double x = Math.cos(lat1) * Math.sin(lat2)
                - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        double bearing = Math.toDegrees(Math.atan2(y, x));
        return (bearing + 360.0) % 360.0;
    }

    record ClosestPoint(double distanceMeters, GeoPoint closestPoint, double bearingDegrees, double segmentBearingDegrees) {
    }

    private record SegmentProjection(double distanceMeters, GeoPoint closestPoint) {
    }
}
