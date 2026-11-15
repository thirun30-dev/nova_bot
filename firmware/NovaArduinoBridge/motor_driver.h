/***************************************************************
   Motor driver function definitions - by James Nugen
   *************************************************************/

#ifdef L298_MOTOR_DRIVER
  #define RIGHT_MOTOR_BACKWARD 5
  #define LEFT_MOTOR_BACKWARD  6
  #define RIGHT_MOTOR_FORWARD  9
  #define LEFT_MOTOR_FORWARD   10
  #define RIGHT_MOTOR_ENABLE 12
  #define LEFT_MOTOR_ENABLE 13
#endif

#ifdef TB6612_MOTOR_DRIVER
  // Encoders use 2, 3 (left) and A4, A5 (right); PWM must be on 3/5/6/9/10/11.
  #define LEFT_MOTOR_PWM   6    // TB6612 PWMA
  #define LEFT_MOTOR_IN1   7    // AIN1
  #define LEFT_MOTOR_IN2   8    // AIN2
  #define RIGHT_MOTOR_PWM  9    // PWMB
  #define RIGHT_MOTOR_IN1  10   // BIN1
  #define RIGHT_MOTOR_IN2  11   // BIN2
  #define MOTOR_STBY       4    // STBY (HIGH = driver enabled)
#endif

void initMotorController();
void setMotorSpeed(int i, int spd);
void setMotorSpeeds(int leftSpeed, int rightSpeed);
