package com.example.demo.repository;

import com.example.demo.entity.CrossroadDirectionLinkEntity;
import com.example.demo.entity.CrossroadDirectionLinkId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

@Repository
public interface CrossroadDirectionLinkRepository
        extends JpaRepository<CrossroadDirectionLinkEntity, CrossroadDirectionLinkId> {

    List<CrossroadDirectionLinkEntity> findByIdCrsrdIdIn(Collection<String> crsrdIds);

    @Modifying
    @Transactional
    void deleteByIdCrsrdIdIn(Collection<String> crsrdIds);
}
