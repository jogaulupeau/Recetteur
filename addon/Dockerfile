ARG BUILD_FROM
FROM ${BUILD_FROM}

# Recetteur n'a aucune dépendance npm : Node.js seul suffit (pas de npm install).
RUN apk add --no-cache nodejs

WORKDIR /opt/recetteur
COPY app/ /opt/recetteur/
COPY run.sh /run.sh
RUN chmod a+x /run.sh

# Les données vivent dans /data, volume persistant fourni par le superviseur :
# le contenu de /opt/recetteur est remplacé à chaque mise à jour, pas celui-ci.
ENV RECETTEUR_DATA_DIR=/data

CMD [ "/run.sh" ]
