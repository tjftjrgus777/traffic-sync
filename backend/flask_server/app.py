import joblib
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import datetime
import xgboost
import oracledb
import os

app = Flask(__name__)
CORS(app)

# 1. 모델 로드
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model = joblib.load(os.path.join(BASE_DIR, 'xgboost_traffic_model.joblib'))

# 2. DB 접속 설정
db_config = {
     "user": "ADMIN",
     "password": "Heeyoun1220!",
     "dsn": "koreapoint_medium",


     "wallet_location": "C:/final__project/traffic-sync/backend/src/main/resources/wallet"


}

# 3. 모델 입력 컬럼 순서 (학습 시와 동일해야 함)
FEATURE_COLUMNS = [
     'Station_Number', 'Direction', 'Latitude', 'Longitude',
     'Hour', 'Weekday_Weekend', 'Year', 'Month', 'Day_of_Week_Num'
]

def get_station_from_db(station_id):
     conn = None
     # 설정된 지갑 경로 사용
     wallet_path = db_config["wallet_location"]

     try:
          # 오라클 클라우드 접속 설정
          conn = oracledb.connect(
               user=db_config["user"],
               password=db_config["password"],
               dsn=db_config["dsn"],
               config_dir=wallet_path,
               wallet_location=wallet_path,
               wallet_password=db_config["password"]
          )
          cursor = conn.cursor()

          # 쿼리 실행 (대소문자 구분 없이 TRAFFIC_STATION 테이블 조회)
          sql = "SELECT STATION_NAME, LATITUDE, LONGITUDE FROM TRAFFIC_STATION WHERE STATION_ID = :1"
          cursor.execute(sql, [int(station_id)])
          row = cursor.fetchone()

          if row:
               print(f"DB 조회 성공! [ID {station_id}] -> {row[0]}")
               result = {"name": row[0], "lat": float(row[1]), "lng": float(row[2])}
          else:
               print(f"DB에 ID {station_id} 데이터가 없습니다.")
               result = None

          cursor.close()
          return result

     except Exception as e:
          # 접속 실패 시 터미널에 에러 내용을 출력
          print(f"DB 접속 실패 원인: {str(e)}")
          return None
     finally:
          if conn:
               conn.close()


@app.route('/predict_traffic', methods=['POST'])
def predict():
     try:
          req_data = request.get_json(force=True)
          station_id = int(req_data.get('Station_Number'))

          # DB에서 해당 지점 정보(이름, 위경도) 가져오기
          info = get_station_from_db(station_id)

          if not info:
               return jsonify({
                    'success': False,
                    'error': f'ID {station_id} 정보를 DB에서 찾을 수 없습니다.'
               }), 404

          predictions_list = []
          # 오늘 00시부터 23시까지 예측 데이터 생성
          base_date = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

          for i in range(24):
               future_time = base_date + datetime.timedelta(hours=i)

               # 시간 데이터 보정 (모델 학습 기준)
               year = future_time.year
               month = future_time.month
               hour_val = future_time.hour + 1  # 0~23 -> 1~24
               day_of_week = future_time.weekday()
               weekday_weekend = 1 if day_of_week < 5 else 0

               hour_results = {
                    'time': future_time.strftime('%H:00'),
                    'direction_0': 0,
                    'direction_1': 0
               }

               # 상행(0), 하행(1) 각각 예측
               for direction in [0, 1]:
                    input_data = {
                         'Station_Number': station_id,
                         'Direction': direction,
                         'Latitude': info['lat'],
                         'Longitude': info['lng'],
                         'Hour': hour_val,
                         'Weekday_Weekend': weekday_weekend,
                         'Year': year,
                         'Month': month,
                         'Day_of_Week_Num': day_of_week
                    }

                    # DataFrame 변환 및 컬럼 순서 정렬
                    input_df = pd.DataFrame([input_data], columns=FEATURE_COLUMNS)

                    # XGBoost 예측 수행
                    pred_value = model.predict(input_df)[0]
                    hour_results[f'direction_{direction}'] = max(0, int(round(float(pred_value))))

               predictions_list.append(hour_results)

          return jsonify({
               'success': True,
               'station_number': station_id,
               'station_name': info['name'],
               'forecast': predictions_list
          })

     except Exception as e:
          return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
     # Flask 서버 실행
     app.run(debug=True, host='0.0.0.0', port=5002)