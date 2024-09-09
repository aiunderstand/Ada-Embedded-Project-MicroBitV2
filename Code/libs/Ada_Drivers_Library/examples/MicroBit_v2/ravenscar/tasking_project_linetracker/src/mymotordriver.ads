With MicroBit.IOsForTasking; use MicroBit.IOsForTasking;

package MyMotorDriver is

   type Directions is (Forward, Left, Right, Stop);
       
   protected MotorDriver is
      function GetDirection return Directions; 
      
      procedure SetDirection (V : Directions); 
      
      private
      DriveDirection : Directions := Stop;
   end MotorDriver;

end MyMotorDriver;
