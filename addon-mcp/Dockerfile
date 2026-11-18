ARG BUILD_FROM
FROM ${BUILD_FROM}

# Python seul, sans paquet pip : start.py n'utilise que la bibliothèque standard.
RUN apk add --no-cache python3

# L'intégration à installer dans Home Assistant (copie de custom_components/recetteur_mcp, assemblée par `npm run package`).
COPY app/integration /opt/integration
COPY app/start.py /opt/start.py
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
