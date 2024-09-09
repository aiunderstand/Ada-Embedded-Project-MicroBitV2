--Important: use Microbit.IOsForTasking for controlling pins as the timer used there is implemented as an protected object
With MicroBit.IOsForTasking; use MicroBit.IOsForTasking; -- we only depend on this for Analog_Value definition and Pin_Id. This could be abstracted so there is a smaller dependency!

package MyMotorDriver is

   type Directions is (Forward, Stop); --only two are implemented but many configuration are possible with mecanum wheels
   
   type MotorControllerPins is record
           LF_ENB  : Pin_Id;
           LF_IN3 : Pin_Id;
           LF_IN4 : Pin_Id;
           LB_ENA : Pin_Id;
           LB_IN1 : Pin_Id;
           LB_IN2 : Pin_Id;
                          
           RF_ENA : Pin_Id;
           RF_IN1 : Pin_Id;
           RF_IN2 : Pin_Id;
           RB_ENB : Pin_Id;
           RB_IN3 : Pin_Id;
           RB_IN4 : Pin_Id;
   end record;

   type Wheel is record
      PinForward : Pin_Id;
      PinBackward : Pin_Id;
      PinSpeed : Pin_Id;  
      PinForwardValue: Boolean;
      PinBackwardValue: Boolean;
      PinSpeedValue: Analog_Value;
   end record;
   
   protected MotorDriver is
      -- see https://learn.adacore.com/courses/Ada_For_The_Embedded_C_Developer/chapters/03_Concurrency.html#protected-objects
      function GetDirection return Directions; -- concurrent read operations are now possible
      function GetMotorPins return MotorControllerPins; -- concurrent read operations are now possible

      procedure SetMotorPins (V : MotorControllerPins); -- but concurrent read/write are not!
      procedure SetDirection (V : Directions); -- but concurrent read/write are not!
   private
      DriveDirection : Directions := Stop;
      Pins : MotorControllerPins;
   end MotorDriver;

end MyMotorDriver;
