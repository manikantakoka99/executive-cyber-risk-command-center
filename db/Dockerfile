FROM postgres:16-alpine

# First-boot init imports reference/CyberCommandCenter_Sample_Data.xlsx.
# Alpine's Python is newer than the psycopg2-binary wheels, so use the
# distro binding and a pure-Python workbook reader.
RUN apk add --no-cache python3 py3-psycopg2 py3-pip \
 && pip3 install --break-system-packages --no-cache-dir 'openpyxl==3.1.5'
